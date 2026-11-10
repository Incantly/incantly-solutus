# Text, typeset maths, logic: failures

Error objects follow `../errors/design.md` section 3. Area letters for codes: `X` for text and typesetting, `J` for logic and relations.

Two classes, as in the kernel: **errors** (the line was rejected, figure unchanged) and **undefined values** (accepted, with `reason` and `detail`). A malformed text or formula that can be detected from the line alone is an error. A text that depends on a value that is missing is not: it renders with a dash.

---

## 1. Line errors

### 1.1 Reused kinds

| Kind | When | GeoGebra | Ours |
|---|---|---|---|
| `syntax`, `unbalanced`, `unterminated_string`, `bad_escape` | The line or a `{expr}` inside a string does not parse | One generic "check your input" message for the line | Position inside the string: `col` points at the character in the whole line; `expected` lists what was legal there |
| `unknown_name` | A `{name}` part names an object that does not exist | The name is kept as literal text, or an error dialog | Error; `suggest` offers the nearest name, `hint` shows the escape `\{` if a literal brace was meant |
| `no_matching_form` | Argument count/types fit no form | "Illegal argument" | `forms` (4 plus `formsOmitted`) and the failing position |
| `type_mismatch` | `cases` branches of different types; `Split` of a Number | Silent conversion or generic error | Error naming both types |
| `limit` | Text over 20,000 characters, table over 10,000 cells, list over 100,000 pieces | Slow or frozen | Error with the limit |

### 1.2 New kinds

| Kind | Code | Phase | When | GeoGebra | Ours |
|---|---|---|---|---|---|
| `bad_format` | X001 | resolve | A `{x:fmt}` format is not in the list (`2`, `.3`, `3sf`, `deg`, `deg2`, `f`, `%`, `sci`, `tex`, `ord`) or does not apply to the part's type (`{flag:2}` on a Bool) | Silently uses a default | Error at the format token; `expected` lists formats valid for that type |
| `unbalanced_math` | X002 | parse | A `$` opens a math part with no closing `$` | The text shows raw dollar signs or the formula fails to draw | Error at the opening `$`; `hint` offers `\$` or `latex = off` |
| `latex_unsupported` | X003 | resolve | A macro or environment outside the subset (section 6.3 of design) | Depends on the renderer: a red box, a blank, or the raw source | Error at the macro; `token` is the macro; `suggest` has a supported alternative when known (`\over` to `\frac`); hint on `latex = full` in phase 2 |
| `latex_syntax` | X004 | resolve | Subset parser fails: missing `}`, `^` with no base, `\frac` with one argument, unmatched `\left` | Rendering error, no position | Error with the column inside the math source, mapped to the line column; `expected` e.g. `["}"]` |
| `bad_align` | X005 | typecheck | `TableText` `align` string has a letter outside `l c r .`, or `border`/`brackets` value not in the list | Pattern is parsed leniently | Error listing allowed letters or values |
| `ragged_table` | X006 | notice | Rows of different lengths | Padded | Notice only (section 1.3) |
| `bad_relation_kind` | J001 | typecheck | `Related(a, b, "foo")` with a kind not in the set, or one that does not apply to the pair (`"tangent"` for two numbers) | n/a | Error; `expected` lists the kinds that apply to that pair of types |
| `bad_binding` | J002 | typecheck | `CountIf` / `KeepIf` variable name is not a free name, or the condition does not use it, or the condition is not a Bool | Implicit `x`; condition not using it gives odd results | Error with the reason; for an unused variable a warning notice `unused_binding` instead |
| `non_function_branch` | J003 | typecheck | A piecewise `f(x) = cases(...)` has a condition that does not depend only on `x` | Treated as a general function | Error; hint says to use `if` on values instead |
| `missing_else` | J004 | parse | `if(c, a)` or `cases(c1, v1)` with no final `otherwise` | Returns undefined when false | Error with `suggest` containing the line with `, undefined` added |
| `bad_code_point` | X007 | typecheck | A literal argument to `UnicodeToLetter` or `UnicodeToText` is outside 0 to 1,114,111 or in the surrogate range | Wraps or garbles | Error at the value; a computed value gives undefined `out_of_domain` |
| `text_too_long` | X008 | commit | A text over 20,000 characters | Slow | `limit` kind with `limit: "text_length"` (same object shape) |

### 1.3 Notices

| Code | Kind | When |
|---|---|---|
| X101 | `ragged_table` | A table had rows of different lengths and was padded |
| X102 | `skipped_undefined` | `CountIf` or `KeepIf` skipped items where the condition was undefined |
| X103 | `unused_binding` | The bound name is not used in the condition |
| X104 | `overlapping_cases` | Two conditions of a piecewise function both hold on part of the plotted range |
| X105 | `self_crossing` | `IsInRegion` used the even-odd rule because the polygon crosses itself |
| X106 | `dash_in_text` | One or more live parts are undefined and printed as a dash (lists the names) |
| X107 | `tolerance_match` | A relation held within tolerance but not exactly |
| X108 | `approximate_match` | `SurdText` matched a float within tolerance |

---

## 2. Undefined values (not errors)

| Reason | Detail | Meaning | Typical command | GeoGebra | Ours |
|---|---|---|---|---|---|
| `out_of_domain` | X201 | A code point outside the valid range; an `Ordinal` of a negative or non-integer; a number outside the domain of a format | `UnicodeToLetter(1114112)`, `Ordinal(-2)` | Question mark or odd text | `detail.text` names the argument and range |
| `not_finite` | X202 | NaN or infinity given to a number-format command | `ScientificText`, `FractionText` | Prints `NaN` or `?` | Undefined with the argument's value |
| `no_convergence` | X203 | `FractionText` could not meet the tolerance within `maxDen`; `ContinuedFraction` would exceed reliable digits | `FractionText(pi, 100)` | Returns the best it found, silently | Undefined, with the best fraction in `detail.suggest` as a ready line (`FractionText(pi, 1000)`) |
| `empty_list` | X204 | `LetterToUnicode("")` | | Question mark | Standard |
| `degenerate` | J101 | `IsInRegion` with a polygon of fewer than 3 distinct vertices; a circle of zero radius treated as a point is allowed | `IsInRegion` | Undefined | `detail` says which |
| `unsupported` | J102 | `Relation` of a pair with no rule; `SurdText` of a type it cannot take | `Relation` | The sentence "no relation found" | Undefined with `detail.text` listing the supported pairs |
| `input_undefined` | | An input of a command is undefined | any | | Standard, with `cause`; **except** texts, which render with a dash and stay defined |
| `index_out_of_range` | | `T[i]` out of range (language area) | | | Standard |
| `limit` | X205 | A split would produce over 100,000 pieces; a table over 10,000 cells computed at run time | `Split`, `TableText` | Slow | Undefined with the limit name |
| `timeout` | | Layout of an unusually large formula over the budget (20 ms) | drawing | Slow | The text is drawn as plain `v` with a marker; no cell is undefined (layout is a view matter) |
| `not_set` | | A branch was the literal `undefined` | `if(c, a, undefined)` | Undefined | `not_set` |

**Layout is not a kernel failure.** If a math part fails to lay out at draw time (font missing, a corrupt box), the view falls back to the plain `v` string and logs a developer message; the kernel value is unaffected.

---

## 3. Numeric failures

| Situation | GeoGebra | Ours |
|---|---|---|
| Rounding ties (`0.5`, `1.005`, `2.675`) | Binary value decides, surprising | Shortest-decimal rule: half away from zero; tested |
| `-0` formatting | Can print `-0` | Prints `0` |
| Huge or tiny values in `fixed` | Long strings | `fixed` stays fixed up to 1e21; beyond that switches to `sci` with the notice `format_switched` |
| `FractionText` of a float with noise | Wrong fractions at tight tolerance | Tolerance relative to the value; exact inputs exact |
| `SurdText` random false matches | Tolerance-based, may match nonsense | Bounded coefficient size and 40-digit relation search; `meta.match` and `approximate_match` flag |
| `ContinuedFraction` of an irrational float | Garbage after the 15th digit | Stops when the remaining precision cannot support the next term |
| `Normal`-like tail formatting | n/a | Not in this area |
| Catastrophic regex | Possible freeze | No regex in v1; linear-time matcher in phase 2 |

---

## 4. Limits

| Limit | Value | Result |
|---|---|---|
| Text length | 20,000 characters | `text_too_long` |
| Live parts per text | 200 | `limit` |
| Nested math depth | 40 | `latex_syntax` with "too deeply nested" |
| Table cells | 10,000 | `limit` |
| Split pieces | 100,000 | undefined `limit` |
| `Relation` closure depth | 8 | `now` basis only |
| Layout cache | 2,000 entries | evicts oldest |

---

## 5. Examples

### 5.1 Bad format

Line: `T = Text("Angle {θ:degrees}", (0, 0))`.

```json
{
  "ok": false,
  "committed": false,
  "kind": "bad_format",
  "code": "X001",
  "phase": "resolve",
  "message": "degrees is not a number format.",
  "line": 1, "col": 20, "endCol": 27, "token": "degrees",
  "expected": ["2", ".3", "3sf", "deg", "deg2", "f", "%", "sci"],
  "forms": [],
  "hint": "Use deg to show an angle in degrees, or deg1 for one decimal.",
  "suggest": ["T = Text(\"Angle {θ:deg}\", (0, 0))"],
  "recovery": "use_suggestion",
  "related": ["θ"],
  "fingerprint": "bad_format:degrees"
}
```

### 5.2 Unsupported macro

Line: `F = Text("$\\tikzpicture$", (1, 1))`.

```json
{
  "ok": false,
  "committed": false,
  "kind": "latex_unsupported",
  "code": "X003",
  "phase": "resolve",
  "message": "\\tikzpicture is not supported in typeset maths.",
  "line": 1, "col": 14, "endCol": 26, "token": "\\tikzpicture",
  "expected": [],
  "forms": [],
  "hint": "The formula engine handles fractions, roots, scripts, matrices and operators. For a drawing use the figure's objects.",
  "suggest": [],
  "recovery": "rewrite",
  "fingerprint": "latex_unsupported:\\tikzpicture"
}
```

### 5.3 LaTeX syntax inside math

Line: `F = Text("$\\frac{1}$", (1, 1))`.

```json
{
  "ok": false,
  "committed": false,
  "kind": "latex_syntax",
  "code": "X004",
  "phase": "resolve",
  "message": "\\frac needs two groups, found one.",
  "line": 1, "col": 20, "endCol": 21, "token": "}",
  "expected": ["{"],
  "forms": [],
  "hint": "Write \\frac{numerator}{denominator}.",
  "suggest": ["F = Text(\"$\\\\frac{1}{2}$\", (1, 1))"],
  "recovery": "fix_line",
  "fingerprint": "latex_syntax:frac:1"
}
```

### 5.4 Missing else

Line: `m = if(a > 0, a)`.

```json
{
  "ok": false,
  "committed": false,
  "kind": "missing_else",
  "code": "J004",
  "phase": "parse",
  "message": "if needs three parts: a test, a value when true, and a value when false.",
  "line": 1, "col": 5, "endCol": 17, "token": "if(a > 0, a)",
  "expected": [","],
  "forms": ["if(c: Bool, a: T, b: T) -> T"],
  "hint": "If you want 'no value' when false, write undefined.",
  "suggest": ["m = if(a > 0, a, undefined)"],
  "recovery": "use_suggestion",
  "fingerprint": "missing_else"
}
```

### 5.5 Relation kind that does not fit

Line: `ok = Related(A, B, "parallel")` where `A`, `B` are Points.

```json
{
  "ok": false,
  "committed": false,
  "kind": "bad_relation_kind",
  "code": "J001",
  "phase": "typecheck",
  "message": "parallel does not apply to two Points.",
  "line": 1, "col": 22, "endCol": 32, "token": "\"parallel\"",
  "expected": ["equal", "distinct"],
  "forms": ["Related(a, b, kind: Text) -> Bool"],
  "hint": "For two points use equal or distinct.",
  "suggest": ["ok = Related(A, B, \"distinct\")"],
  "recovery": "choose",
  "related": ["A", "B"],
  "fingerprint": "bad_relation_kind:Point:Point:parallel"
}
```

### 5.6 Unsupported relation (undefined)

```json
{
  "name": "r",
  "type": "Text",
  "defined": false,
  "reason": "unsupported",
  "detail": {
    "code": "J102",
    "text": "Relation does not compare a Polygon with a Number. Supported pairs: Number/Number, Point/Point, Point/Line, Point/Circle, Point/Polygon, Line/Line, Line/Circle, Circle/Circle, Polygon/Polygon.",
    "suggest": ["r = Relation(Area(P), 12)"]
  }
}
```

### 5.7 Dash in text (notice, text still defined)

```json
{
  "ok": true,
  "name": "label",
  "type": "Text",
  "value": "The intersection is at (–, –)",
  "notices": [{
    "code": "X106",
    "kind": "dash_in_text",
    "severity": "warning",
    "message": "I is undefined (the lines are parallel), so it shows as a dash.",
    "names": ["I"]
  }]
}
```

### 5.8 FractionText cannot meet the tolerance

```json
{
  "name": "f",
  "type": "Text",
  "defined": false,
  "reason": "no_convergence",
  "detail": {
    "code": "X203",
    "text": "No fraction with denominator at most 100 is within 1e-9 of 3.14159265. The closest is 311/99.",
    "suggest": ["f = FractionText(pi, 1000)"]
  }
}
```

---

## 6. How the model recovers

| Kind or reason | Next line |
|---|---|
| `bad_format` | Use the format in `suggest`; see the formats list in the catalogue |
| `latex_unsupported` | Use a supported macro or put the words in plain text |
| `latex_syntax` | Fix the braces; resend |
| `unbalanced_math` | Escape the dollar sign (`\$`) or close the math |
| `missing_else` | Use the `suggest` line |
| `bad_relation_kind` | Pick a kind from `expected` |
| `unknown_name` in a `{name}` | Define the object first (or fix the spelling) |
| undefined `no_convergence` | Use the `suggest` line with a larger limit, or say "about" |
| undefined `unsupported` | Say what you can and compare the numbers directly |
| notice `dash_in_text` | Explain the missing value out loud (the lines are parallel), or fix the cause |

At most two retries per line; after that the teacher describes only what was drawn.
