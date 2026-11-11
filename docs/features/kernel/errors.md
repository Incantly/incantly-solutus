# Kernel: failures

Every failure the kernel can produce, how GeoGebra handles it, and how we do it. The format, the full catalogue of kinds and the recovery rules shared by all areas live in `../errors/`; this file lists the kernel's own cases and shows the objects. Error objects follow `../errors/design.md` section 3.

Two classes, never mixed:

- **Errors**: the line was rejected. The figure is unchanged. Returned as data.
- **Undefined values**: the line was accepted; the maths cannot produce a value. The figure changes; the object carries a reason.

---

## 1. Line-level errors from the kernel

Parse errors (`syntax`, `unbalanced`, `bad_number`, `unterminated_string`) belong to the language area and are catalogued in `../errors/errors.md`. The kernel owns the cases below.

| Kind | Raised when | GeoGebra | Ours |
|---|---|---|---|
| `unknown_name` | a name does not exist | Offers to create sliders, or splits the name into a product (`ab` becomes `a*b`), or reports "undefined variable" | Always an error. `suggest` includes a line that would define it (`a = 1 in 0..10`) and the nearest existing names. |
| `name_taken` | `Rename` to an existing name | "label already in use" | Error with the object that holds it in `related`. |
| `bad_name` | `Rename` to an invalid name | rename failed | Error naming the rule that broke (starts with digit, reserved word, forbidden character). |
| `reserved_name` | defining a command, built-in or keyword | silently shadows or fails | Error with the list of near-by free names. |
| `cycle` | redefinition would make an object depend on itself | circular definition | Error with `path`: the chain `["A", "B", "A"]`. Self-reference on a free Number, Point or Bool is *not* an error (assignment). |
| `type_change` | redefinition changes type | redefinition failed (no detail) | Error with old and new types; hint `Delete(X)` first or choose another name. |
| `locked` | redefine, delete or drag a fixed object | "fixed objects may not be changed" | Error with hint `X with fixed = false`. |
| `not_free` | set a value on a dependent object (`show_me`, slider tool, drag) | "dependent objects may not be changed" | Error; `suggest` offers the free parents (`dragPlan` result) or `X = <value>` to make it free. |
| `forward_reference` | insert or reorder places an object before its input | silently reordered or "not possible" | Error naming the input that must move first; `suggest` has the move. |
| `unknown_property` | `with foo = ...` | n/a (dialog) | Error listing valid keys for that object type. |
| `bad_property_value` | value of the wrong type or range (`layer = 12`, `opacity = 3`) | clamps silently | Error with allowed range; no silent clamping for literals. Dynamic expressions that evaluate out of range clamp at read time (documented, section 9.4 of design). |
| `nothing_to_undo` | `Undo()` with empty history (also `Redo()`) | button disabled | Error, `recovery: 'skip'`. |
| `limit` | any size budget exceeded | out-of-memory or hang | Error with `limit` field naming which and the allowed value. |
| `load_failed` | `fromScript` finds a bad version or a strict failure | "opening file failed" | Error plus the per-line list. |
| `internal` | a rule threw (a bug) | stack trace in console, figure may be half updated | Rolled back; `committed: false`; `code` and a `fingerprint` for logs. |

---

## 2. Undefined values (not errors)

The kernel defines the reason codes. Rules return one; the engine adds `input_undefined` with `cause`.

| Reason | Meaning | Typical rules |
|---|---|---|
| `parallel` | two lines do not meet | `Intersect(Line, Line)` |
| `coincident` | the same line or circle; infinitely many answers | `Intersect` |
| `no_intersection` | shapes do not meet (circle and line apart) | `Intersect` |
| `out_of_domain` | input outside what the function accepts | `sqrt`, `ln`, `asin` |
| `division_by_zero` | divisor is zero | `/`, `Tangent` slope of a vertical |
| `no_root` | no sign change found | `Root` |
| `not_finite` | result is NaN or infinite | any formula |
| `overflow` | value too large to keep | big powers, `exp` |
| `degenerate` | zero-length, collinear, zero radius | `Angle`, `Circle(A,B,C)` |
| `index_out_of_range` | list or intersection index too big | list access |
| `empty_list` | list has no elements | `Mean([])` |
| `no_convergence` | a numeric method gave up | `Root`, `Extremum`, solver |
| `timeout` | a rule used up its work budget and stopped itself (the wall-clock budget is only a fallback, see `../errors/design.md` section 8) | heavy numerics, solver |
| `input_undefined` | an input is undefined; see `cause` | inherited |
| `not_set` | the free value is the literal `undefined` | free Number |
| `limit` | result would exceed a size limit | huge `Seq` |

A rule must return a specific reason, never a generic one. A test iterates every rule's declared `reasons` list and checks each can be reached by an example.

Shape of the cell: `{ defined: false, reason, cause?: ObjId }`. In the change report: `{ name, reason, cause?: name }`. In the `figure` tool: `"undefined": { "reason": "parallel" }` or `{ "reason": "input_undefined", "cause": "I", "root": "parallel" }` where `cause` is the nearest undefined input and `root` is the reason at the end of the `cause` chain.

GeoGebra: a failed output is just "undefined"; the user must work backwards to see why.

---

## 3. Notices (accepted, but worth saying)

Returned in `notices` on the result (ruling K3; `changed.warnings` holds the same array, kept so older readers work). They never block. The full table, with templates, is in `../errors/errors.md` section 4.

| Kind | Code | When |
|---|---|---|
| `became_undefined` | K101 | the line made existing objects undefined (lists them) |
| `became_defined` | K102 | objects are defined again |
| `dependents_removed` | K103 | `Delete` cascaded to other objects (lists them) |
| `moved_for_order` | K104 | redefinition moved objects earlier |
| `property_detached` | K105 | a property rule lost an input (the slider that coloured it was deleted); property reverted to static |
| `confusable_name` | K106 | new name differs from an existing one only by case |
| `redefined_to_same` | K107 | no structural change (value refreshed only) |
| `listener_failed` | K108 | a listener threw; the figure is fine |
| `step_hidden` | K109 | an object was added after the step the learner is viewing |
| `clamped` | K110 | a free write was moved to the end of the slider's range |
| `shadowed_default` | K111 | style set to what the default already is (no change) |
| `unstable_state` | K112 | a state became unstable |

---

## 4. Example error objects

Unknown name that looks like a slider:

```json
{
  "ok": false,
  "line": 2,
  "col": 15,
  "endCol": 16,
  "kind": "unknown_name",
  "phase": "resolve",
  "code": "K001",
  "token": "k",
  "message": "k is not defined.",
  "params": { "name": "k" },
  "expected": [],
  "hint": "Define it first, or use a name that exists: A, B, M.",
  "suggest": ["k = 1 in 0..10"],
  "recovery": "create_first",
  "committed": false
}
```

Cycle:

```json
{
  "ok": false,
  "line": 5,
  "col": 1,
  "endCol": 20,
  "kind": "cycle",
  "phase": "plan",
  "code": "K010",
  "token": "A = Midpoint(M, B)",
  "message": "A would depend on itself: A -> M -> A.",
  "path": ["A", "M", "A"],
  "hint": "M is made from A. Use a different input, or redefine M first.",
  "recovery": "rewrite",
  "committed": false
}
```

Locked:

```json
{
  "ok": false, "line": 3, "col": 1, "endCol": 10, "kind": "locked", "phase": "plan", "code": "K014",
  "token": "P = (1, 1)",
  "message": "P is fixed and cannot be changed by a line.",
  "hint": "Unfix it first: P with fixed = false",
  "suggest": ["P with fixed = false"],
  "recovery": "choose",
  "committed": false
}
```

Type change:

```json
{
  "ok": false, "line": 4, "col": 1, "endCol": 14, "kind": "type_change", "phase": "typecheck", "code": "K011",
  "token": "c = Circle(O, 2)",
  "message": "c is a Number; this line would make it a Circle.",
  "params": { "from": "Number", "to": "Circle" },
  "hint": "Pick a new name, or Delete(c) first (this removes 2 objects that use c: d, e).",
  "suggest": ["c2 = Circle(O, 2)"],
  "recovery": "rewrite",
  "committed": false
}
```

Unknown property:

```json
{
  "ok": false, "line": 6, "col": 14, "endCol": 20, "kind": "unknown_property", "phase": "typecheck", "code": "K020",
  "token": "colour",
  "message": "Segment has no property colour.",
  "expected": ["color", "width", "lineStyle", "visible", "label", "caption", "layer", "showIf", "opacity", "fixed", "selectable", "aux", "trace", "tip", "tags"],
  "hint": "Did you mean color?",
  "suggest": ["s with color = red"],
  "recovery": "rewrite",
  "committed": false
}
```

Blocked by an earlier failure in the same batch:

```json
{
  "ok": false, "line": 3, "col": 14, "endCol": 15, "kind": "unknown_name", "phase": "resolve", "code": "K001",
  "token": "T",
  "message": "T is not defined. Line 2 tried to define it and failed.",
  "blockedBy": { "line": 2, "kind": "no_matching_form" },
  "hint": "Fix line 2 first; this line will then work unchanged.",
  "recovery": "fix_earlier",
  "committed": false
}
```

Undefined value reported (not an error), in a successful `TxResult`:

```json
{
  "ok": true, "line": 4, "name": "I", "type": "Point", "op": "add",
  "summary": "I is undefined (parallel)",
  "changed": {
    "added": ["I"], "removed": [], "redefined": [], "moved": [],
    "becameUndefined": [{ "name": "I", "reason": "parallel" }],
    "becameDefined": [], "warnings": []
  }
}
```

Internal:

```json
{
  "ok": false, "line": 7, "col": 1, "endCol": 30, "kind": "internal", "phase": "commit", "code": "K999",
  "token": "q = Integral(f, 0, 1)",
  "message": "Something went wrong inside Integral; nothing was changed.",
  "hint": "Try a simpler form of this line, or skip it.",
  "recovery": "skip",
  "committed": false,
  "fingerprint": "internal:Integral:3f9c"
}
```

---

## 5. Recovery rules (kernel side)

1. **Atomic.** A rejected line leaves figure, journal and clock exactly as they were. Tests snapshot `toScript()` and the journal depth before and after every failing line in the golden suite and assert equality.
2. **Independent lines.** In a batch, later lines run even if earlier ones failed. Lines that read a failed line's name get `blockedBy`.
3. **Dry run first when unsure.** `apply(line, { dryRun: true })` returns the same error without side effects.
4. **Rollback on throw.** The commit step records the minimum to undo itself before the first mutation; an exception inside a rule or a listener (listeners run after commit and cannot undo it, but their errors are caught and reported as `listener_failed` notices, never allowed to break the figure) rolls back and returns `internal`.
5. **No silent repair.** The kernel never guesses a name, creates sliders or splits a name into a product. It offers a `suggest` line; the caller decides.
6. **Cascade is explicit.** Delete returns the list of removed names, always. `deletePlan` returns the list before the delete.
7. **Undefined never throws.** Only a bug throws; a bug is `internal`.

## 6. Limits

| Limit | Default | Error `limit` value |
|---|---|---|
| objects per figure | 5,000 | `objects` |
| expression nodes per line | 400 | `expr_nodes` |
| line length | 2,000 | `line_length` |
| list size | 100,000 | `list_size` |
| elements in a range `[a..b]` | 100,000 | `range_elements` |
| rule nesting depth | 64 | `depth` |
| comments and directives per figure | 5,000 | `items` |
| lines in one batch or loaded file | 20,000 | `lines` |
| characters in a free Text value | 10,000 | `text_length` |
| load file size | 2 MB | `file_size` |
| journal entries | 500 | none (oldest dropped; reported by `undoInfo`) |
| journal bytes | 4 MB | none (oldest dropped; reported by `undoInfo`) |

Limits are values in a `Limits` object passed to the figure (`objects`, `exprNodes`, `lineLength`, `listSize`, `depth`, `journalEntries`, `journalBytes`, `ruleBudgetMs`, `fileSize`, `items`, `lines`, `textLength`, and `extra` for the entries areas add); hosts can lower them (a classroom tablet) or raise them (an author tool). `range_elements` and the other limits only the language checks are in `../language/errors.md` section 7.

Expression nodes: the language's own cap is 2,000 (language errors 7). Inside a figure the kernel passes its `exprNodes` value (400) to the language, so 400 applies there.

**Rule cost.** The kernel never stops a rule because of wall-clock time. `ruleBudgetMs` (default 2 ms) is a profiling aid: when the host passes a clock, a rule that runs longer is listed in `slowRules`. A rule whose cost can grow counts its own iterations against a work budget and returns `no_convergence` or `timeout` when it is spent, so the same inputs give the same result on every machine (`../errors/design.md` section 8).
