# Kernel: how an AI model uses it

The kernel's own surface for the model is small: define things, restyle them, delete, undo, ask. This file gives the exact lines, the catalogue entries, what `draw` and `figure` return, and how the live teacher speaks while using them.

## 1. Lines the model writes

```text
A = (1, 2)                          # free point (learner can drag)
a = 3 in 0..10 step 0.5             # slider
flag = true                         # checkbox
M = Midpoint(A, B)                  # dependent
M = Midpoint(A, C)                  # redefine: same name, same type
A with color = red, layer = 2       # restyle
P with showIf = (a < 3)             # appear only while a < 3
P with color = hsl(360 * a / 10, 1, 0.5)   # dynamic colour
Hide(M)    Show(M)
Delete(M)                           # removes M and all that use M
Rename(M, N)
Undo()     Redo()
DependsOn(M)    Uses(A)    Describe(M)
```

Rules the model must follow (in the system prompt, three lines):

1. Name every object. A new object is `Name = ...`.
2. To change something, write its name again: `Name = ...` (redefine) or `Name with ...` (style). Do not delete and recreate.
3. An error means the line did nothing. Fix that line and send it again.

## 2. Catalogue entries (kernel part)

One line each, in the same format as the command catalogue.

```text
Name = expr                      define or redefine (same type only)
Name = expr in a..b [step s]     Number slider
Name with key = value, ...       restyle. keys: color width lineStyle pointSize pointStyle opacity fill label caption visible showIf layer(0-9) fixed selectable aux trace tip tags
Show(obj, ...)  Hide(obj, ...)   visibility
Delete(obj)                      remove obj and everything built from it
Rename(obj, "NewName")           change the name
Undo()  Redo()                   take back / restore the last line
Describe(obj) DependsOn(obj) Uses(obj)   ask the figure (read only)
```

Token budget: this block is about 170 tokens. The error schema reminder (section 4) is about 120 tokens. Total kernel share of the prompt: under 300 tokens. The property key list is the only part that grows; keep it one line.

## 3. Results the model gets back

`draw` returns, per line:

Success (compact):

```json
{ "line": 1, "ok": true, "name": "M", "type": "Point", "op": "add", "summary": "M = (2, 1)" }
```

Success with consequences (only non-empty fields appear):

```json
{
  "line": 3, "ok": true, "name": "A", "type": "Point", "op": "redefine", "summary": "A = (6, 0)",
  "changed": { "becameUndefined": [{ "name": "I", "reason": "parallel" }], "moved": ["B"] }
}
```

Delete:

```json
{ "line": 4, "ok": true, "op": "delete", "summary": "deleted A, M, c", "changed": { "removed": ["A", "M", "c"] } }
```

Error: the object from `errors.md` section 4. The model sees `kind`, `token`, `hint`, `suggest`, `forms`. It must prefer a `suggest` line when one exists.

`figure` returns, per object:

```json
{ "name": "M", "id": 3, "type": "Point", "definition": "Midpoint(A, B)", "value": "(2, 1)", "defined": true, "free": false,
  "visible": true, "shown": true, "fixed": false, "aux": false, "layer": 0, "inputs": ["A", "B"], "dependents": [] }
```

`value` is the value as text. `undefined` appears only when the object is undefined, and `why` only when `shown` is false.

Hidden because of a condition:

```json
{ "name": "P", "type": "Point", "definition": "(1, 1)", "value": "(1, 1)", "defined": true, "visible": true, "shown": false, "why": "showIf a < 3 is false" }
```

Undefined with a chain:

```json
{ "name": "T", "type": "Point", "definition": "Midpoint(I, B)", "value": "undefined", "defined": false,
  "undefined": { "reason": "input_undefined", "cause": "I", "root": "parallel" } }
```

`figure` accepts an optional filter (`names`, `type`, `onlyProblems`) so the model can ask for undefined objects only (`onlyProblems: true`), which is the cheap way to check a build before speaking about it.

## 4. Fixing errors: the model's decision table

| `kind` | First move |
|---|---|
| `unknown_name` | Use a `suggest` line, or define the object first in the same call, or pick an existing name from the hint. If `blockedBy` is present, fix the earlier line, then resend this one unchanged. |
| `type_change` | Choose a new name (`suggest`); do not delete unless the old object is unwanted. |
| `cycle` | Read `path`; redefine the middle object first, or use a different input. |
| `locked` | Unfix only if the teacher itself fixed the object earlier in this lesson. Otherwise say "that point is pinned" and build elsewhere. |
| `not_free` | Redefine the object (`Name = value`) if the lesson wants it free, or change its free parent. |
| `unknown_property` / `bad_property_value` | Use `expected` or the allowed range. |
| `limit` | Do less (smaller list), then continue. |
| `internal` | Skip the line; do not retry the same text. |

A line is retried at most twice. The same `fingerprint` twice means stop and move on.

## 5. Worked lesson snippets

### 5.1 Midpoint and an undefined object (no error)

Teacher: "Here are two lines that start at the same corner."
```text
O = (0, 0)
Q = (4, 1)
l1 = Line(O, Q)
```
Result: all ok. Teacher: "Now a second line, parallel to the first, through this point."
```text
P = (0, 2)
l2 = Parallel(P, l1)
I = Intersect(l1, l2)
```
`draw` returns `ok` for `I` with `becameUndefined: [{name: "I", reason: "parallel"}]`.
Teacher: "These two lines never meet, so there is no crossing point. That is what parallel means." (It describes the reported reason, not its intention.)

### 5.2 Redefinition keeps the figure alive

Teacher: "Let me move the corner."
```text
A = (6, 0)
```
`draw` returns `op: "redefine"` and no other change. Teacher: "Everything built on it followed."

### 5.3 Recovering from an error

Teacher: "Make a point at the middle."
```text
M = Midpoint(A, Bb)
```
Result: `unknown_name`, token `Bb`, hint "Did you mean B?", `suggest: ["M = Midpoint(A, B)"]`.
Teacher (silently sends the suggestion; says nothing about the slip): "Here is the midpoint of A and B."
```text
M = Midpoint(A, B)
```
Result ok. If the retry had failed twice, the teacher would say only "I'll mark it another way" and move on without naming the failed line.

### 5.4 Taking back an utterance

Learner: "That's not what I meant, go back."
```text
Undo()
```
Result: `op: "undo"`, `changed.removed: ["M"]`. Teacher: "Okay, the midpoint is gone again."

## 6. Rules for talking about the kernel

- Name only what a result reports.
- For a `becameUndefined` entry, say the reason in plain words from a fixed phrase table (`parallel` = "they never meet", `out_of_domain` = "that number has no square root", `no_intersection` = "they don't touch"). The table is in the error area's `agent.md`.
- Never say "I redefined" aloud; say what the learner sees changed.
- Never tell the learner about retries or error kinds.
