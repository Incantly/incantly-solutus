# Errors: how an AI model uses them

## 1. What the model receives

`draw` returns one entry per line. Successes are short; failures are the compact error object (`design.md` 3.5). Example result for a batch of three lines where the second fails:

```json
[
  { "line": 1, "ok": true, "name": "A", "type": "Point", "op": "add", "summary": "A = (0, 0)" },
  {
    "line": 2, "ok": false, "kind": "unknown_command", "code": "K002",
    "token": "Midpont", "col": 5, "endCol": 12,
    "message": "Midpont is not a command.",
    "hint": "Did you mean Midpoint?",
    "suggest": ["M = Midpoint(A, B)"], "recovery": "use_suggestion"
  },
  { "line": 3, "ok": false, "kind": "unknown_name", "code": "K001", "token": "M", "col": 12, "endCol": 13,
    "message": "M is not defined. Line 2 tried to define it and failed.",
    "blockedBy": { "line": 2, "kind": "unknown_command" }, "recovery": "fix_earlier" }
]
```

Compact form omits `source`, `params`, `messageKey`, `fingerprint`, `committed`, `phase` (the model does not need them). `forms` is capped at four lines plus `formsOmitted`. The harness keeps the fingerprint on its side to detect repeats.

## 2. The catalogue lines the model is given (error part)

The system prompt carries a fixed block of about 140 tokens:

```text
A failed line changes nothing. Result fields: kind, token, hint, suggest[], forms[], recovery.
recovery: use_suggestion = send suggest[0]. choose_form = pick one of forms[]. create_first = define the
missing name, then resend. fix_earlier = fix the earlier line named in blockedBy, then resend.
rewrite/fix_line = change the line using hint. skip = leave it out.
Retry a line at most twice. Never repeat the same text. Describe only what succeeded.
```

Total error budget: ~140 tokens (rules) + about 80 to 200 tokens per failed line returned (compact object). With at most five lines per call and typical 0 to 1 failures, the per-call overhead is under 200 tokens.

## 3. Repair procedure

1. Read `recovery`.
2. If `suggest` non-empty and recovery is `use_suggestion`: resend `suggest[0]` as the line (keep other lines of the batch out; only failed ones are resent).
3. `choose_form`: pick the form that matches the lesson's intent; build the line from that form's parameter names.
4. `create_first`: write the definition line for the missing name (use `suggest` if given), then the original line, in one call.
5. `fix_earlier`: repair the earlier line first, in the same call, then resend this one unchanged.
6. `rewrite`/`fix_line`: apply the hint with the smallest change.
7. `choose`: pick the safer option (do not unfix or delete unless the lesson already did that to this object). Prefer building a new object with a new name.
8. `skip`/`report`: do not resend.
9. After two failed retries or an identical error twice: stop; call `figure` if three lines in a row failed; then continue the lesson with what exists.

### Undefined results (not errors)

A successful line can report `becameUndefined`. The model:
- treats it as a fact to teach with if the lesson expects it ("parallel lines don't meet");
- otherwise treats it as a slip: checks `figure` with `onlyProblems: true`, fixes the cause named by `cause`/`root` (redefine the object, not the dependants) and moves on.

## 4. Speech: the phrase table

The teacher says the sentence from the phrase table (`errors.md` section 3) for undefined reasons, never the reason code. For errors, it says nothing about the error. It narrates what it did draw; if the missing piece matters, it says it plainly in lesson terms: "I'll show the midpoint on the board" (after the fix) or "Let's skip that one" (after skip).

## 5. Worked snippets

### 5.1 Typo, fixed silently

Teacher: "First, the circle with centre O through P."
```text
c = Circel(O, P)
```
Result: `unknown_command`, suggest `["c = Circle(O, P)"]`, recovery `use_suggestion`.
Teacher (no comment on the slip): "And here it is."
```text
c = Circle(O, P)
```
Result ok.

### 5.2 Wrong form

Teacher: "A circle around O with radius up to P."
```text
c = Circle(O, P, 3)
```
Result: `no_matching_form`, forms (three), suggest `["c = Circle(O, P)", "c = Circle(O, 3)"]`.
The lesson says "through P", so the model sends the first suggestion.
```text
c = Circle(O, P)
```

### 5.3 Missing definition (create first)

Teacher: "Let the slope change as we move this slider."
```text
l = Line((0, 0), (1, m))
```
Result: `unknown_name`, token `m`, suggest `["m = 1 in -5..5"]`, recovery `create_first`.
Teacher: "Here is the slope, and the line follows it."
```text
m = 1 in -5..5
l = Line((0, 0), (1, m))
```
Both ok.

### 5.4 Giving up gracefully (two failures)

Teacher: "Now the hatching under the curve."
```text
r = Hatch(f, 0, 2)
```
Result: `unknown_command` (no close name, no suggestion). Retry 1 uses a catalogue command with a wrong argument shape: `r = AreaUnder(f, 0, 2, 5)` gives `no_matching_form` with the valid forms. Retry 2 picks the matching form:
```text
r = AreaUnder(f, 0, 2)
```
It succeeds. Had it failed, the model would stop after two retries and say only what exists: "Here is the curve between zero and two."

### 5.5 Undefined as the lesson

Teacher: "What happens when the two lines never meet?"
```text
I = Intersect(l1, l2)
```
Result ok, `becameUndefined: [{name:"I", reason:"parallel"}]`.
Teacher: "These lines are parallel, so they never meet, and there's no crossing point." (phrase table)

### 5.6 Batch stop

Three consecutive lines fail with `unknown_name`. Model calls `figure`, sees only `O` exists, and writes the missing definitions first.

## 6. Do and do not

- Do prefer `suggest`. Do copy `forms` parameter names exactly.
- Do not echo an error to the learner. Do not apologise.
- Do not delete and recreate to avoid `type_change`; pick a new name.
- Do not use `unfix` as a first reaction to `locked`.
- Do not write a comment line instead of fixing a line.

## 7. Token budget for this area

| Item | Tokens |
|---|---|
| Rules block (once) | ~140 |
| Compact error, typical | 80 to 200 |
| `forms` of a heavy command (4 lines) | up to 120 |
| Phrase table (loaded with the first undefined report) | ~170 |
