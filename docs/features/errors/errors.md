# Errors: the catalogue

Every kind of failure across Incantly, the way the reference app treats it, and ours in the format of `design.md` section 3. Codes: `L` language (lex/parse), `K` kernel (names, graph, properties, history, limits), `C` command table (forms and arguments), `T` tools. Codes never change once released.

## 1. Catalogue of error kinds

Columns: **kind / code**, **when**, **The reference app**, **our message template**, **default recovery**, **extras carried**.

### 1.1 Lex and parse (language area raises, phase `lex` or `parse`)

| Kind / code | When | The reference app | Template | Recovery | Extras |
|---|---|---|---|---|---|
| `syntax` L001 | parser stops at a token that cannot continue the line | One generic "check your input", position lost | `Unexpected {token}. Expected {expected}.` | fix_line | `expected` (up to 8 tokens or classes like `a number`), `suggest` for known patterns |
| `unbalanced` L002 | bracket opened and not closed, or closed and never opened | "unbalanced brackets" without position | `{open} on column {col} is never closed.` / `Unmatched {close}.` | use_suggestion | `col` points at the unmatched bracket; `suggest` adds the missing one at end of line |
| `bad_number` L003 | `1.2.3`, `.`, `1e999` | generic | `{token} is not a valid number.` | fix_line | `suggest` tries trimming |
| `unterminated_string` L004 | quote never closed | generic | `The text starting at column {col} has no closing quote.` | use_suggestion | |
| `bad_character` L005 | a character the language never uses (smart quotes, `;`, tab inside names) | generic | `Character {token} is not part of the language.` | use_suggestion | `suggest` replaces smart quotes, `×`, `÷`, `−`, `²` with `"`, `*`, `/`, `-`, `^2` |
| `unknown_directive` L006 | `@foo` | n/a | `{token} is not a directive.` | fix_line | `expected` = directive names, closest in `hint` |
| `bad_directive` L007 | directive exists, arguments wrong | n/a | `{directive} needs {expected}.` | fix_line | `forms` = the directive's forms |

### 1.2 Names and structure (kernel, phase `resolve`/`plan`)

| Kind / code | When | The reference app | Template | Recovery | Extras |
|---|---|---|---|---|---|
| `unknown_name` K001 | a name that does not exist | Offers sliders, or splits to a product, or "undefined variable" | `{name} is not defined.` | create_first or use_suggestion | `suggest` (closest names; a define line when used as a number), `blockedBy` |
| `unknown_command` K002 | PascalCase word that is not a command | "unknown command" | `{name} is not a command.` | use_suggestion | `suggest` (closest 3 commands as complete lines when args fit), `hint` lists the group |
| `reserved_name` K003 | defining a command, built-in, constant or keyword | silent shadow | `{name} is reserved and cannot name an object.` | rewrite | `suggest` free names (`{name}1`, `{name}_`) |
| `bad_name` K004 | invalid characters, leading digit, empty, too long | rename failed | `{name} cannot be a name: {why}.` | rewrite | `params.why` |
| `name_taken` K005 | `Rename` to existing | "label in use" | `{name} is already used by a {type}.` | rewrite | `related` the owner |
| `unnamed_object` K006 | object command with no name on the line | n/a (auto-labels) | `Give the result a name: Name = {line}.` | use_suggestion | `suggest` with a free name from the naming helper |
| `duplicate_param` K007 | `f(x, x) = ...` | n/a | `The parameter {name} appears twice.` | fix_line | |
| `not_callable` K008 | `a(2)` where `a` is not a function | tries a product | `{name} is a {type}, not a function or command.` | fix_line | `suggest` with `*` when it is a number (`a * (2)`) |
| `unknown_property` K020 | `with foo = ...` | n/a | `{type} has no property {key}.` | use_suggestion | `expected` = valid keys |
| `bad_property_value` K021 | wrong type or range for a property | clamps silently | `{key} must be {allowed}; got {token}.` | fix_line | `params.allowed` |

### 1.3 Graph and history (kernel, phase `plan`)

| Kind / code | When | The reference app | Template | Recovery | Extras |
|---|---|---|---|---|---|
| `cycle` K010 | redefinition makes an object depend on itself | "circular definition" | `{name} would depend on itself: {path}.` | rewrite | `path` |
| `type_change` K011 | redefine changes type | "redefinition failed" | `{name} is a {from}; this line would make it a {to}.` | rewrite | `params.from/to`, dependents count |
| `forward_reference` K012 | insert/reorder places an object before one of its inputs | reordering silently or not possible | `{name} needs {input}, which is defined later.` | choose | `suggest` move |
| `not_free` K013 | set a value on a dependent object | "dependent objects may not be changed" | `{name} is computed from {inputs}; it has no value of its own to set.` | choose | `suggest` free parents or redefinition |
| `locked` K014 | change/delete a fixed object | "fixed objects may not be changed" | `{name} is fixed and cannot be changed by a line.` | choose | `suggest` `{name} with fixed = false` |
| `missing_rate` K015 | state with no `name' =` | n/a | `{name} is a state but has no rate. Add {name}' = ...` | create_first | `suggest` `{name}' = 0` |
| `nothing_to_undo` K030 | `Undo()`/`Redo()` on empty | button disabled | `There is nothing to {undo}.` | skip | |

### 1.4 Command table (phase `typecheck`)

| Kind / code | When | The reference app | Template | Recovery | Extras |
|---|---|---|---|---|---|
| `no_matching_form` C001 | argument count and types fit no form | "illegal argument" plus syntax lines | `{command} has no form ({given}).` | choose_form | `forms` (all, up to 4 shown), `suggest` (when exactly one form is one edit away, the edited line) |
| `arg_count` C002 | a user function or a single-form command with wrong count | "illegal number of arguments" | `{name} takes {n} argument(s); got {m}.` | fix_line | `forms` |
| `type_mismatch` C003 | operator on bad types | "illegal addition/subtraction/multiplication/division/exponent/comparison/boolean/list operation" | `Cannot {op} a {left} and a {right}.` | rewrite | `params.op`, left, right; `suggest` for known conversions (`Point - Point` as `Vector(P, Q)`) |
| `bad_argument` C004 | right type, impossible value known at plan time | "illegal argument" | `{command}: {why}.` | fix_line | `params.why` e.g. `a polygon needs at least 3 points` |
| `bad_range` C005 | `in a..b` with `a >= b`, or `step <= 0`, or `step > b - a` | n/a | `The range {a}..{b} is empty.` | fix_line | |

### 1.5 Limits, load and faults

| Kind / code | When | The reference app | Template | Recovery | Extras |
|---|---|---|---|---|---|
| `limit` K040 | any budget exceeded | hang or crash | `That would exceed the limit of {max} {what}.` | rewrite | `params.limit/max/got` |
| `load_failed` K041 | strict load failed, or file unreadable | "opening file failed" | `The file could not be loaded: {n} line(s) failed.` | report | list in the load report |
| `version` K042 | file newer than supported | file errors | `This file is version {v}; supported: {list}.` | report | |
| `tool_input` T001 | teacher tool called with a malformed or empty request | n/a | `{tool} needs {expected}.` | fix_line | `forms` |
| `tool_busy` T002 | a tool call arrived while the previous one runs on the same figure | n/a | `The figure is busy; try again.` | skip | |
| `internal` K999 | a bug: an exception inside a rule, tool or listener | stack trace in console | `Something went wrong inside {where}; nothing was changed.` | skip | `fingerprint` |

## 2. How each kind is detected (and how we avoid false errors)

- `syntax`: the parser is hand-written recursive descent with a single token of lookahead, so `expected` is exact at the failing token. Errors are reported at the *first* token that cannot continue; if the missing piece is at the end of line, `col` = line length + 1 and `token` is empty.
- `unbalanced`: counted during lexing with a stack; the opening bracket's position is remembered.
- `unknown_name` and `unknown_command`: the resolver has the whole name table; edit-distance suggestions use the object names and command names only (not keywords) and are limited to distance ≤ max(1, floor(len/3)).
- `no_matching_form`: the checker computes for each form the *first* argument that fails; the form with the longest matching prefix is considered closest, and `suggest` is produced only if a single token edit (drop, add, swap two) makes that form match.
- `type_mismatch` vs `no_matching_form`: operators raise the first; calls to commands raise the second.
- `cycle`: from the downstream array of the object being redefined (a binary search per new input); path is rebuilt by a short DFS only when failing.
- `bad_range`/`bad_argument`: only when the offending values are literal or free constants at plan time. If they depend on a slider, the rule returns undefined (`degenerate`/`limit`) at run time instead.

## 3. Undefined reasons (run-time, not errors)

Same list as `kernel/errors.md` section 2, with plain-language phrases. The phrase table is the single source for the UI, the screen reader and the teacher's speech.

| Reason | Phrase (noun form) | Phrase (sentence for speech) |
|---|---|---|
| `parallel` | "parallel lines" | "These lines are parallel, so they never meet." |
| `coincident` | "the same line" | "These are the same line, so there is no single crossing." |
| `no_intersection` | "no crossing" | "They don't touch each other." |
| `out_of_domain` | "outside the allowed values" | "That input isn't allowed there, for example the square root of a negative number." |
| `division_by_zero` | "division by zero" | "That divides by zero." |
| `no_root` | "no zero in range" | "The graph doesn't cross zero in this range." |
| `not_finite` | "not a number" | "That value can't be worked out." |
| `overflow` | "too large" | "That number is too big to show." |
| `degenerate` | "degenerate shape" | "The points line up (or coincide), so there is no shape." |
| `index_out_of_range` | "no such item" | "There is no item at that position." |
| `empty_list` | "empty list" | "The list has nothing in it." |
| `no_convergence` | "no result found" | "The search didn't settle on an answer." |
| `timeout` | "too slow" | "That took too long to work out." |
| `input_undefined` | "depends on {cause}, which is undefined ({root phrase})" | "It depends on {cause}, which {root sentence}" |
| `not_set` | "not set" | "This has no value yet." |
| `limit` | "too big" | "That would be too large." |

The numeric reasons carry an optional `detail`, a short plain-text fact such as `reached 3e-4, wanted 1e-9 after 50 iterations`, used by authors, not spoken. `detail` is one string, as in the cell (`Cell.detail`).

## 4. Notices (success with facts)

| Kind / code | When | Template | Carries |
|---|---|---|---|
| `became_undefined` K101 | a line made existing objects undefined | `{names} became undefined: {phrase}.` | list with reasons |
| `became_defined` K102 | objects came back | `{names} are defined again.` | list |
| `dependents_removed` K103 | delete cascaded | `Also removed: {names}.` | list |
| `moved_for_order` K104 | redefinition moved objects | `Moved {names} earlier.` | list |
| `property_detached` K105 | property rule lost an input | `{name}'s {prop} followed {input}; it now uses the plain {prop}.` | |
| `confusable_name` K106 | name differs only by case from another | `{name} differs from {other} only by case.` | |
| `redefined_to_same` K107 | no structural change | `{name} was already defined that way.` | |
| `listener_failed` K108 | a listener threw (view, film) | `A view failed to update; the figure is fine.` | where |
| `step_hidden` K109 | new object added while step cursor is before the end | `{name} is added after the step you are viewing.` | |
| `clamped` K110 | a free write was moved to the end of the slider's range | `{name} was moved to {value}, the {end} of its range.` | |
| `shadowed_default` K111 | a style was set to what the default already is | `{name}: {key} is already {value}.` | |
| `unstable_state` K112 | a state became unstable (the solver blew up) | `The state {names} became unstable at t = {t}.` | |

## 5. Examples

### 5.1 syntax

```json
{
  "ok": false, "committed": false, "kind": "syntax", "code": "L001", "phase": "parse",
  "messageKey": "lang.syntax", "params": { "token": ")", "expected": ["a number", "a name", "("] },
  "message": "Unexpected ). Expected a number, a name or (.",
  "line": 1, "col": 15, "endCol": 16, "token": ")", "source": "A = (1, 2) + ()",
  "expected": ["a number", "a name", "("], "forms": [],
  "hint": "A point needs two numbers: (x, y).",
  "suggest": [], "recovery": "fix_line", "fingerprint": "syntax:)", "severity": "error"
}
```

### 5.2 unbalanced

```json
{
  "ok": false, "committed": false, "kind": "unbalanced", "code": "L002", "phase": "lex",
  "messageKey": "lang.unbalanced_open", "params": { "open": "(" },
  "message": "( on column 12 is never closed.",
  "line": 2, "col": 12, "endCol": 13, "token": "(", "source": "M = Midpoint(A, B",
  "expected": [")"], "forms": [], "suggest": ["M = Midpoint(A, B)"], "recovery": "use_suggestion",
  "fingerprint": "unbalanced:(", "severity": "error"
}
```

### 5.3 unknown_command

```json
{
  "ok": false, "committed": false, "kind": "unknown_command", "code": "K002", "phase": "resolve",
  "messageKey": "kernel.unknown_command", "params": { "name": "Midpont" },
  "message": "Midpont is not a command.",
  "line": 1, "col": 5, "endCol": 12, "token": "Midpont", "source": "M = Midpont(A, B)",
  "expected": [], "forms": [], "hint": "Did you mean Midpoint?",
  "suggest": ["M = Midpoint(A, B)"], "recovery": "use_suggestion",
  "fingerprint": "unknown_command:Midpont", "severity": "error"
}
```

### 5.4 no_matching_form with a one-edit suggestion

```json
{
  "ok": false, "committed": false, "kind": "no_matching_form", "code": "C001", "phase": "typecheck",
  "messageKey": "cmd.no_matching_form", "params": { "command": "Circle", "given": "Point, Point, Number" },
  "message": "Circle has no form (Point, Point, Number).",
  "line": 3, "col": 5, "endCol": 25, "token": "Circle(O, P, 2)", "source": "c = Circle(O, P, 2)",
  "expected": [],
  "forms": [
    "Circle(center: Point, radius: Number) -> Circle",
    "Circle(center: Point, through: Point) -> Circle",
    "Circle(a: Point, b: Point, c: Point) -> Circle"
  ],
  "hint": "Remove one argument, or pass three points.",
  "suggest": ["c = Circle(O, P)", "c = Circle(O, 2)"], "recovery": "choose_form",
  "fingerprint": "no_matching_form:Circle:Point,Point,Number", "severity": "error"
}
```

### 5.5 type_mismatch

```json
{
  "ok": false, "committed": false, "kind": "type_mismatch", "code": "C003", "phase": "typecheck",
  "messageKey": "cmd.type_mismatch", "params": { "op": "*", "left": "Point", "right": "Point" },
  "message": "Cannot multiply a Point and a Point.",
  "line": 4, "col": 5, "endCol": 10, "token": "A * B", "source": "d = A * B",
  "expected": [], "forms": [],
  "hint": "For the distance, use Distance(A, B). For a vector, use Vector(A, B).",
  "suggest": ["d = Distance(A, B)"], "recovery": "rewrite",
  "fingerprint": "type_mismatch:*:Point:Point", "severity": "error"
}
```

### 5.6 bad_property_value

```json
{
  "ok": false, "committed": false, "kind": "bad_property_value", "code": "K021", "phase": "typecheck",
  "messageKey": "kernel.bad_property_value", "params": { "key": "layer", "allowed": "a whole number from 0 to 9" },
  "message": "layer must be a whole number from 0 to 9; got 12.",
  "line": 5, "col": 20, "endCol": 22, "token": "12", "source": "A with color = red, layer = 12",
  "expected": ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"], "forms": [],
  "suggest": ["A with color = red, layer = 9"], "recovery": "fix_line",
  "fingerprint": "bad_property_value:layer", "severity": "error"
}
```

### 5.7 bad_range

```json
{
  "ok": false, "committed": false, "kind": "bad_range", "code": "C005", "phase": "typecheck",
  "messageKey": "cmd.bad_range", "params": { "a": "5", "b": "0" },
  "message": "The range 5..0 is empty.",
  "line": 2, "col": 17, "endCol": 21, "token": "5..0", "source": "a = 3 in 5..0",
  "expected": [], "forms": ["Name = value in min..max [step s]"],
  "suggest": ["a = 3 in 0..5"], "recovery": "use_suggestion",
  "fingerprint": "bad_range", "severity": "error"
}
```

### 5.8 limit

```json
{
  "ok": false, "committed": false, "kind": "limit", "code": "K040", "phase": "plan",
  "messageKey": "kernel.limit", "params": { "limit": "list_size", "max": 100000, "got": 1000000, "what": "list items" },
  "message": "That would exceed the limit of 100000 list items.",
  "line": 1, "col": 5, "endCol": 28, "token": "Seq(k^2, k, 1, 1000000)", "source": "L = Seq(k^2, k, 1, 1000000)",
  "expected": [], "forms": [], "hint": "Use fewer items, or sample with a larger step.",
  "suggest": [], "recovery": "rewrite", "fingerprint": "limit:list_size", "severity": "error"
}
```

### 5.9 tool_input

```json
{
  "ok": false, "committed": false, "kind": "tool_input", "code": "T001", "phase": "tool",
  "messageKey": "tool.input", "params": { "tool": "draw", "expected": "lines: 1 to 5 strings" },
  "message": "draw needs lines: 1 to 5 strings.",
  "line": 0, "col": 0, "endCol": 0, "token": "", "expected": ["lines"], "forms": ["draw(lines: string[1..5])"],
  "hint": "Send at most five lines per call.", "suggest": [], "recovery": "fix_line",
  "fingerprint": "tool_input:draw", "severity": "error"
}
```

## 6. Errors in the error system

- If building an error object itself throws (a bad template), the fallback is a hard-coded `internal` object with `code: "K999"`, `message: "Something went wrong."`, `fingerprint: "internal:error-build"`. A test seeds the registry with a faulty entry and checks the fallback.
- If a suggestion helper throws, `suggest` is `[]`; the rest of the error is unaffected.
- Errors are plain JSON-safe data: no `Error` instances, no `undefined`, no functions, no cyclic references. A schema test validates every golden error against a JSON Schema.

## 7. Golden tests (how we prove the catalogue)

For each kind: at least three source lines that must produce it with exact `line`, `col`, `endCol`, `token`, `kind`, `code`; a line that must *not* produce it (the near-miss); a check that `suggest` lines parse and apply cleanly; a check that applying the failing line leaves `toScript()` identical (atomicity). A fuzz test feeds random truncations and single-character mutations of valid lines and asserts: no exception escapes, every result is `ok` or an `ErrorObject`, and the `col` lies within the line (+1).

Acceptance (from the core design): the model fixes an error on its next line in 9 of 10 cases on an error test set. The set is built from ~300 mutated lines (typos in names, commands, missing brackets, wrong arity, type slips); a harness replays the model on each and counts.
