# Algebra view and input bar: errors

Language errors (lexing, parsing, names, types, arguments, redefinition, limits) are in `docs/features/language/errors.md`. This file covers failures that belong to the view and the bar: restrictions, edits, renames, sliders, formatting, and the UI's behaviour when the kernel returns an error. All use the error object from core section 9 as extended in the language errors file.

## 1. Kinds owned by this area

| Kind | When | GeoGebra | Ours |
|---|---|---|---|
| `restricted` | The input bar or a row edit uses a command not on the lesson's allowed list, or input is switched off | Exam mode and app configs hide commands; the user sees "unknown command" | A named restriction: message says the lesson allows only these commands; `forms` lists the allowed commands' first forms |
| `name_taken` | Rename to a name that exists | "Label already used" | Names the existing object and offers a free name in `fix` |
| `bad_name` | Rename or edit gives an invalid name | "Rename failed" | Names the broken rule (see language errors) |
| `read_only` | An edit or delete of an object the teacher locked, or when the bar is read-only | "Fixed objects may not be changed" | Names the lock owner (`lesson` or `teacher`) |
| `slider_range` | `a in lo..hi` with lo ≥ hi, step ≤ 0, step larger than the range, or a current value that would be outside (value is clamped, which is a warning, not this error) | Silent swap or an empty range | Says which test failed and shows the corrected line |
| `not_a_slider` | `a in 0..10` where `a` is dependent | Not applicable | `fix` offers `a = <current value> in 0..10` (turns it free) |
| `edit_conflict` | A row edit is submitted after the object changed (a film seeked or the model redefined it while the learner typed) | Last write wins | The edit is refused with the new definition shown; the learner's text is kept |
| `stale_selection` | The target of a row action no longer exists | Silent | Toast `That object was deleted`, selection cleared |

All other failures in the bar are language errors and are displayed by the same strip.

## 2. Edit and redefinition

| Case | Result | Notes |
|---|---|---|
| Row edit text has no `=` | The editor prefixes the object's name; if the text still does not parse, `syntax` | The field keeps the text |
| Edit changes type | `type_change` | `hint` offers deleting first. The row keeps its old definition |
| Edit creates a cycle | `cycle` | `related` lists the path; the AV shows the path in the strip |
| Edit would break dependents | `breaks_dependents` | Strip lists dependents as buttons; click selects one |
| Edit a dependent number to a plain value | Allowed; the object becomes free | The strip says `a is now a free number` |
| Edit a free number to an expression | Allowed; the object becomes dependent; any slider range is dropped | A toast offers Undo |
| Edit while the film plays | The film pauses at the current `t`; the edit applies; play does not resume automatically | Prevents a half-typed line from racing the clock |
| Two edits in flight | The second waits for the first to resolve (one transaction at a time) | The bar disables Enter for the first line's duration (under 10 ms normally) |

Example, `restricted`:

```json
{
  "ok": false, "line": 1, "col": 5, "endCol": 14, "severity": "error",
  "kind": "restricted", "token": "Rotate",
  "message": "This activity allows only Midpoint, Segment and Distance.",
  "expected": [],
  "forms": [
    "Midpoint(a: Point, b: Point) -> Point",
    "Segment(a: Point, b: Point) -> Segment",
    "Distance(a: Point, b: Point) -> Number"
  ],
  "hint": "Ask your teacher to allow Rotate, or use one of the commands listed."
}
```

Example, `name_taken`:

```json
{
  "ok": false, "line": 1, "col": 1, "endCol": 14, "severity": "error",
  "kind": "name_taken", "token": "Rename(A, \"B\")",
  "message": "B already names another point.",
  "expected": [], "forms": [],
  "related": [{ "line": 0, "col": 0, "endCol": 0, "note": "B = (4, 6)" }],
  "hint": "Pick a free name, such as C.",
  "fix": "Rename(A, \"C\")"
}
```

Example, `slider_range`:

```json
{
  "ok": false, "line": 1, "col": 1, "endCol": 18, "severity": "error",
  "kind": "slider_range", "token": "a in 10..0",
  "message": "The slider's lowest value must be below its highest value.",
  "expected": [], "forms": [],
  "hint": "Swap the bounds.",
  "fix": "a in 0..10"
}
```

Example, `not_a_slider`:

```json
{
  "ok": false, "line": 1, "col": 1, "endCol": 12, "severity": "error",
  "kind": "not_a_slider", "token": "h in 0..10",
  "message": "h depends on a and b, so it cannot be a slider.",
  "expected": [], "forms": [],
  "hint": "Make h a free number first.",
  "quickFixes": [{ "label": "Make h free at its current value 5",
                   "lines": ["h = 5 in 0..10 step 0.1"] }]
}
```

## 3. Input bar behaviours on failure

| Event | Behaviour | Why |
|---|---|---|
| Kernel returns an error | Field keeps text, error strip shows, nothing changes in the figure or history order | Core transaction rule |
| Multi-line paste fails at line k | Lines 1..k-1 are applied and grouped for undo; the field holds lines k..n; error on k | The remaining lines may depend on k |
| Quick fix accepted | Lines apply as one undo group; if a later line of the group fails, none of the group applies | A fix is all or nothing |
| Preview throws an internal error | Strip says `Preview unavailable`; submit still works | A preview failure must not block input |
| Kernel internal error (`internal`) | Strip says `Something went wrong; your figure is unchanged`; the error with a report id is logged; the field keeps the text | Bugs cannot corrupt the figure because each line is a transaction |
| Input restricted but a saved script uses a hidden command | Loading is not restricted; only typed input is | Restrictions are for learners typing |
| Too many history entries | Oldest dropped at 200 | |
| Paste over 100 lines | `limit` for the bar: `paste_limit`, applies the first 100 only after a confirm | Avoids freezing on accidental big pastes |

## 4. Value display failures

| Situation | Display | Detail |
|---|---|---|
| Undefined | Dash `—` and the reason in words in the second row; hover adds the cause chain | `reason`, `via` from the kernel |
| Very large | `1.23 × 10⁹`; beyond 1e308 is undefined `overflow` | |
| Very small | `1.2 × 10⁻⁸`; below 1e-320 prints `0` with `approx` | |
| Rounded to zero but not zero | `0` and the `approx` marker (≈) on hover: `≈ 0 (1.2e-7)` | So a learner can see the value is not exactly zero |
| Long list | Truncated with a count | Expander shows rest in chunks of 100 |
| Long text | Clipped after 3 lines | |
| Equation whose coefficients cannot be printed in the chosen format (a fraction request on irrational numbers) | Falls back to decimal | No error |
| Fraction format for a value with no simple fraction | Decimal | `approx` marker |
| Row text generation throws | Row shows `name` and `(cannot display)`; error logged | One bad row never blanks the list |

Reason texts used in the second row (built from templates, English v1):

| Reason | Text |
|---|---|
| `out_of_domain` | `not defined for this input` plus the call, e.g. `sqrt(-4)` |
| `division_by_zero` | `division by zero` |
| `overflow` | `too large to represent` |
| `not_finite` | `not a finite number` |
| `index_out_of_range` | `list index 5 is outside 1..3` |
| `empty_list` | `list is empty` |
| `not_integer` | `needs a whole number` |
| `input_undefined` | `undefined because {via} is undefined` |
| `explicit` | `set to undefined` |
| `condition_false` | `the condition is false` |
| `parallel` (geometry) | `the lines are parallel` |
| `no_root` (functions) | `no root in the interval` |

## 5. Slider and range edge cases

| Case | Behaviour |
|---|---|
| `a = 12 in 0..10` | Error `bad_range` (language errors): the value must lie in the range. Two `quickFixes`: clamp the value (`a = 10 in 0..10`) or widen the range (`a = 12 in 0..20`) |
| Step larger than the range | `slider_range` |
| Step produces a non-terminating decimal (0.1 steps over -5..5) | Values are `min + k × step` computed in integer steps, then rounded to the step's decimal places, so there is no drift (4.6 does not become 4.6000000000000005) |
| Range with 1e6 or more steps | Allowed (a slider is continuous); UI snaps by pixel, not by step, when steps exceed pixels |
| Slider value set by a script outside the range | Clamped, `slider_clamped` warning |
| Redefine a slider's value to an expression | Becomes dependent; the range is dropped; toast |
| Delete a slider that others use | `Delete` lists everything removed; the toast offers Undo |
| Angle-tagged slider with a degree range typed as radians | The UI does not guess; labels show degrees, ranges are radians |
| `a in 0..inf` | `bad_range`: bounds must be finite for a slider |
| Animating a slider that a state's rate reads | The explore mode pauses the film clock and shows `Restarting motion` while states replay from 0 (core 7.2) |

## 6. Limits

| Limit | Value |
|---|---|
| Rows rendered at once | Virtualised; no cap |
| Objects | 5,000 (core/limit) |
| History entries | 200 |
| Paste lines | 100 |
| Row text length shown | 400 characters, then `…` with expander |
| Dependency expansion depth | 20 levels; deeper shows `…` |
| Items in a list expander | 100 per chunk |
| Completion list size | 12 |
| Suggestion cards per object | 1 |

## 7. GeoGebra comparison

| Concern | GeoGebra | Ours |
|---|---|---|
| Missing names while typing | A dialog interrupts evaluation | Error with a quick-fix chip |
| Unknown cause for a blank value | Shows `?` | Dash with the reason and the cause chain |
| Failed redefinition | Rebuild fails and the construction is restored | Pre-checked transaction; the list is never touched |
| Restricted command sets | Exam or app configuration hides commands | Per-lesson `restricted` error naming the allowed commands |
| Edit races | Last writer wins | Conflict detected by version, refused with the new definition shown |
