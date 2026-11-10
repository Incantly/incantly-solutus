# Input language: errors

Follows section 9 of the core design: every error is data returned to the caller; nothing opens a dialog; runtime problems are undefined values with reasons, not errors.

## 1. Error object

The core fields stay: `ok`, `line`, `col`, `endCol`, `kind`, `token`, `message`, `expected`, `forms`, `hint`. This area adds optional fields.

```ts
interface KernelError {
  ok: false;
  line: number;             // 1-based line within the submitted batch
  col: number;              // 1-based, in the ORIGINAL text (before normalisation)
  endCol: number;           // exclusive
  kind: ErrorKind;
  severity: 'error';        // warnings use the Warning type, never this
  token: string;            // the offending text as typed
  message: string;          // one sentence, plain words, no jargon
  expected: string[];       // token classes or literal tokens the parser would accept; [] when not a parse error
  forms: string[];          // accepted forms (command and built-in errors); closest first
  hint: string;             // one sentence on how to recover
  fix?: string;             // a complete replacement for THIS line, when one safe candidate exists
  quickFixes?: { label: string; lines: string[] }[];   // multi-line repairs, for the input bar
  related?: { line: number; col: number; endCol: number; note: string }[];   // other spans or objects involved
  more?: KernelError[];     // further independent errors found in the same line (resolve and check steps only)
  after?: number;           // this line failed because an earlier line in the batch failed: its index
}
```

Rules:

- `col` and `endCol` always refer to the text the writer sent. The lexer's offset map converts.
- `fix`, if present, is something that would pass the same checks. It is never a guess between two meanings: when two readings exist, the error has `quickFixes` with both and no `fix`.
- `message` never repeats the whole `forms` list; it names the single problem.
- `hint` is always present, never empty.
- A batch result lists errors per line. Lines after a failed line are still tried (the teacher may have independent lines); a name defined by a failed line produces `unknown_name` with `after` set.

### Undefined reasons (runtime, not errors)

An object whose value cannot be computed stores `{ reason, detail?, via? }`.

| Reason | Meaning |
|---|---|
| `explicit` | The `undefined` constant, or a user `if` branch chose it |
| `condition_false` | Two-argument `if` with a false condition |
| `division_by_zero` | Divisor is exactly zero (or a reciprocal trig function hit an exact pole) |
| `out_of_domain` | Argument outside the function's domain (`sqrt(-1)`, `asin(2)`) |
| `not_finite` | Result is NaN or infinite without a more specific cause |
| `overflow` | Finite inputs, result above the largest double (`fact(200)`) |
| `index_out_of_range` | List index below 1 or above the length |
| `empty_list` | `max([])`, `mean([])` and similar |
| `not_integer` | A function needing a whole number (`fact(2.5)`, list index 1.5) |
| `input_undefined` | Cascade: an input is undefined; `via` names it |
| `no_value_yet` | A state read before its first frame (see core 7.2) |

Other areas add reasons (`parallel`, `no_root`, `no_convergence`). This area owns the ones above.

## 2. Lexical errors (step 1)

| Kind | When | GeoGebra | Ours |
|---|---|---|---|
| `bad_char` | A character not allowed outside strings and comments: other-script letters or digits, emoji, control characters | Accepts letters from nearly every script in names, which allows look-alikes; unknown characters give a generic message | `token` is the character with its code point, `hint` names the ASCII or Greek equivalent when one exists (`Cyrillic а looks like Latin a`) |
| `bad_number` | `1.2.3`, `1e`, `1e999`, `1__0`, `.`, `5.` followed by a name | Fails at evaluation time with a single number-format message | Reported at lex time with a reason in `message`: `two decimal points`, `exponent has no digits`, `out of range` |
| `unterminated_string` | Newline or end before the closing `"` | Generic input error | Points at the opening quote; `expected: ["\""]` |
| `bad_escape` | `\q` in a string | Not detected | `expected` lists `\" \\ \n \{ \}` |
| `bad_format` | `{x:q}` with an unknown format | Not applicable | `expected` lists formats |
| `too_long` | Line over 2,000 characters | None | `limit`-class; `hint` says split the line |
| `too_deep` | Nesting over 64 | Stack overflow possible on deep input | Refused before recursion |

Example, a smart-quote paste:

```json
{
  "ok": false, "line": 1, "col": 11, "endCol": 12, "severity": "error",
  "kind": "bad_char", "token": "а",
  "message": "The character 'а' (U+0430, Cyrillic) is not allowed in a name.",
  "expected": [], "forms": [],
  "hint": "It looks like the Latin letter 'a'. Retype the line with a keyboard that types Latin letters.",
  "fix": "area = pi r^2"
}
```

## 3. Parse errors (step 2)

The parser reports the position of the first token that cannot continue the line and the set of tokens that could.

| Kind | When | GeoGebra | Ours |
|---|---|---|---|
| `syntax` | Any token that no rule accepts | One message, "please check your input", position lost | `expected` has the token classes (`")"`, `"expression"`, `"name"`, `"=="`), sorted by usefulness, at most 8; `token` is the offender, or `end of line` |
| `unbalanced` | A bracket opened and not closed, or a closer with no opener, or `(` closed by `]` | A dedicated unbalanced-brackets error without position | `related` points at the matching opener or the nearest mismatch; `fix` appends the missing closers when the line otherwise parses |
| `unnamed_object` | A line is a bare object command or value (`Circle(A, 2)`, `(1, 2)`, `3 + 4`) | Creates the object and chooses a name | Refuses. `fix` is the same line with the suggested name in front (`c = Circle(A, 2)`) |
| `missing_operator` | Two operands touch where implicit multiplication is not allowed: `a b`, `(a)(b)`, `2 3`, `x y` | Treated as a product (often what was meant, often not) | `fix` inserts `*`; `hint` explains that adjacent names are not multiplied |
| `ambiguous_implicit` | A number-juxtaposed term directly after `/`: `1/2x`, `a/2b` | Reads it as a product chain | No `fix`; `quickFixes` offers `1/(2x)` and `(1/2) x` |
| `chained_comparison` | Mixed directions or chained equality: `1 < x > 0`, `a == b == c` | Accepts and builds an and-chain only for some cases | `hint` says to use `and` |
| `assign_in_expr` | `=` inside an expression (`f(x) = x = 2`, `A = (1, 2) = B`), or an equation written with `=` (`3x + 4y = 12`) | Reads as an equation | `fix` replaces the second `=` with `==` when the left side contains a free `x` or `y`; otherwise no fix |
| `bad_range` | `in` clause with lower bound above upper, or `step <= 0`, or a bound that is not a Number expression | Silently swaps or ignores | `message` names which test failed; `fix` swaps bounds when they are literals |
| `bad_directive` | Unknown or malformed `@` line | n/a | See core; `expected` lists directive names |
| `colon_label` | `A: (1, 2)` or `A := 3` | Accepts both | `syntax` subtype: `fix` rewrites with `=` |

Example, an equation written with `=`:

```json
{
  "ok": false, "line": 1, "col": 8, "endCol": 9, "severity": "error",
  "kind": "assign_in_expr", "token": "=",
  "message": "A line defines one object with '='; this relation between x and y needs '=='.",
  "expected": ["=="], "forms": [],
  "hint": "Name the object on the left: l = 3x + 4y == 12.",
  "fix": "l = 3x + 4y == 12",
  "quickFixes": [{ "label": "Name it l", "lines": ["l = 3x + 4y == 12"] }]
}
```

Example, `syntax` with expectations:

```json
{
  "ok": false, "line": 2, "col": 18, "endCol": 19, "severity": "error",
  "kind": "syntax", "token": ",",
  "message": "Unexpected ',' in a call to Circle: the argument before it is missing.",
  "expected": ["expression", ")"], "forms": [
    "Circle(center: Point, radius: Number) -> Circle",
    "Circle(center: Point, through: Point) -> Circle",
    "Circle(a: Point, b: Point, c: Point) -> Circle"
  ],
  "hint": "Write Circle(A, 2): centre first, then radius or a point on the circle."
}
```

Example, ambiguous division:

```json
{
  "ok": false, "line": 3, "col": 11, "endCol": 14, "severity": "error",
  "kind": "ambiguous_implicit", "token": "2x",
  "message": "'1/2x' can mean (1/2)x or 1/(2x).",
  "expected": [], "forms": [],
  "hint": "Add brackets for the one you mean.",
  "quickFixes": [
    { "label": "(1/2) x", "lines": ["h = (1/2) x"] },
    { "label": "1/(2x)",  "lines": ["h = 1/(2x)"] }
  ]
}
```

## 4. Name errors (step 3)

| Kind | When | GeoGebra | Ours |
|---|---|---|---|
| `unknown_name` | A name that is not an object, constant, binder or parameter | Offers to create sliders, or splits into a product, or errors "undefined variable" depending on context | Always an error. `hint` names the closest existing name (edit distance, and "all parts known" for products) |
| `unknown_command` | PascalCase name not in the command table, or a command used without arguments | "Unknown command" | `hint` lists up to 3 closest commands, case-insensitive. A lower-case `circle(` is `unknown_function` with the PascalCase hint |
| `unknown_function` | Lower-case call that is not a function object or built-in | Treats as product when the name is a number | `hint` suggests the nearest built-in |
| `not_callable` | Call on an object or constant that is not a function (`a(2)`, `pi(2)`, `x(1)`) | Reads as a product | `fix` inserts `*` when the callee is a Number; for `x(`, `fix` writes `x * (...)` |
| `free_variable` | `x` or `y` outside a function parameter list or a relation | Creates a function silently, or undefined variable | `fix` turns the line into a function definition when exactly one free variable is used |
| `reserved_name` | Defining a command, built-in, constant, keyword or `t x y z` | "Illegal label" without saying why | `message` says which group; `hint` gives a free alternative via `suggestName` |
| `bad_name` | Name fails the name rules: leading digit, over 32 characters, trailing `_`, `P_` | Accepts many odd names | Names the broken rule |
| `name_taken` | `Rename` to a name in use | "Label already used" | Names the owner object |
| `duplicate_param` | `f(x, x) = …` | Not enforced | Points at the second `x` |
| `duplicate_arg` | A command named argument given twice or twice positionally and by name | Not enforced | Names the parameter |
| `not_a_binder` | A binder position got something other than a bare name (`Seq(k^2, 3, 1, 5)`) | n/a | `expected: ["name"]` |

Example, an unknown name that is a product of known names:

```json
{
  "ok": false, "line": 4, "col": 5, "endCol": 7, "severity": "error",
  "kind": "unknown_name", "token": "ab",
  "message": "There is no object called 'ab'.",
  "expected": [], "forms": [],
  "hint": "a and b both exist. Did you mean a * b?",
  "fix": "p = a * b"
}
```

Example, a slider that was never made. The input bar shows the quick fix as a chip; the teacher can send the same two lines:

```json
{
  "ok": false, "line": 2, "col": 10, "endCol": 11, "severity": "error",
  "kind": "unknown_name", "token": "k",
  "message": "There is no object called 'k'.",
  "expected": [], "forms": [],
  "hint": "Make k a number first, or pick an existing name.",
  "quickFixes": [{ "label": "Create slider k from -5 to 5",
                   "lines": ["k = 1 in -5..5 step 0.1", "g(x) = k x"] }]
}
```

Example, a free variable:

```json
{
  "ok": false, "line": 1, "col": 9, "endCol": 10, "severity": "error",
  "kind": "free_variable", "token": "x",
  "message": "x is only available inside a function or an equation, and 'a' is a plain number.",
  "expected": [], "forms": [],
  "hint": "Write a function: a(x) = x + 1, or an equation: l = y == x + 1.",
  "fix": "a(x) = x + 1"
}
```

## 5. Type and argument errors (step 4)

| Kind | When | GeoGebra | Ours |
|---|---|---|---|
| `type_mismatch` | An operator, field, index, `if` branch, list element or call argument of the wrong type | "Illegal addition / multiplication / comparison", no types named | `message` names both types and the operator; extra fields `left`, `right` (type names); `hint` offers the legal neighbours (`Vector(A)`, `Dilate`, `dot`) |
| `no_matching_form` | A command or built-in with no form matching count and types | Command's "illegal argument" then the syntax list | `forms` lists all forms, closest first; `problems` array (below) names each wrong argument |
| `type_change` | A redefinition would change the object's type | "Redefinition failed" | Both types in the message; `hint` says `Delete(A)` first, or that a different name avoids this |
| `cycle` | A redefinition makes an object depend on itself | "Circular definition", no path | `related` lists the path A → B → C → A |
| `breaks_dependents` | A redefinition is legal alone but a dependent no longer type-checks | The whole construction is rebuilt and fails, message "Redefinition failed" | `related` lists each dependent with the error it would get; nothing changes |
| `empty_list_type` | `[]` where no type can be inferred | n/a | `hint`: use `Seq` or give a first element |
| `bad_arity` | A function object called with the wrong number of arguments (`f(1, 2)` for one parameter) | "Illegal number of arguments" | Same as `no_matching_form` with the single form |
| `unit_mismatch` | Reserved for later (angles with lengths); not raised in v1 | | |

`no_matching_form` adds a `problems` field:

```ts
problems?: { argIndex: number; param?: string; expected: string; got: string; col: number; endCol: number }[];
```

Example:

```json
{
  "ok": false, "line": 5, "col": 5, "endCol": 20, "severity": "error",
  "kind": "no_matching_form", "token": "Circle(A, 2, 3)",
  "message": "Circle takes 2 or 3 arguments; you gave 3 of the wrong kinds. Argument 3 is a Number, but the 3-argument form needs a Point.",
  "expected": [],
  "forms": [
    "Circle(a: Point, b: Point, c: Point) -> Circle",
    "Circle(center: Point, radius: Number) -> Circle",
    "Circle(center: Point, through: Point) -> Circle"
  ],
  "problems": [
    { "argIndex": 1, "param": "b", "expected": "Point", "got": "Number", "col": 15, "endCol": 16 },
    { "argIndex": 2, "param": "c", "expected": "Point", "got": "Number", "col": 18, "endCol": 19 }
  ],
  "hint": "Use Circle(A, 2) for a radius, or three points."
}
```

Example, operator on types:

```json
{
  "ok": false, "line": 3, "col": 5, "endCol": 10, "severity": "error",
  "kind": "type_mismatch", "token": "2 * A",
  "left": "Number", "right": "Point",
  "message": "Number * Point is not defined: a point is a position, not a vector.",
  "expected": [], "forms": [],
  "hint": "To scale a position about the origin write 2 * Vector(A); to scale about a centre use Dilate(A, 2, C).",
  "quickFixes": [
    { "label": "Position vector", "lines": ["w = 2 * Vector(A)"] },
    { "label": "Dilate about O",  "lines": ["A2 = Dilate(A, 2, (0, 0))"] }
  ]
}
```

Example, a redefinition that would break something:

```json
{
  "ok": false, "line": 1, "col": 1, "endCol": 14, "severity": "error",
  "kind": "breaks_dependents", "token": "f(x, y) = x*y",
  "message": "Changing f to two parameters would break 2 objects that call f with one.",
  "expected": [], "forms": [],
  "related": [
    { "line": 0, "col": 0, "endCol": 0, "note": "g: g(x) = f(x) + 1 would be a bad_arity error" },
    { "line": 0, "col": 0, "endCol": 0, "note": "Tangent line T uses f with one argument" }
  ],
  "hint": "Redefine g and T first, or name the new function differently."
}
```

Cycle example:

```json
{
  "ok": false, "line": 1, "col": 1, "endCol": 10, "severity": "error",
  "kind": "cycle", "token": "a = b + 1",
  "message": "a would depend on itself through b and c.",
  "expected": [], "forms": [],
  "related": [
    { "line": 0, "col": 5, "endCol": 6, "note": "b is defined by c + 2" },
    { "line": 0, "col": 5, "endCol": 6, "note": "c is defined by a * 2" }
  ],
  "hint": "Break the loop by making one of them a plain number."
}
```

## 6. Command-specific argument errors

The command table's `describe` and `forms` give the data for all commands. Domain checks that depend on values (a radius below 0, a polygon with fewer than 3 points) are not errors: they are undefined with a reason from the command's area. The language only raises type, count and name errors.

## 7. Limits

| Limit | Value | Kind |
|---|---|---|
| Line length | 2,000 characters | `too_long` |
| Tokens per line | 800 | `too_long` |
| Nesting depth | 64 | `too_deep` |
| Expression nodes per line | 2,000 | `limit` |
| Name length | 32 | `bad_name` |
| List literal elements | 10,000 | `limit` |
| Range size `[a..b]` | 100,000 elements | `limit` |
| Elements in all lists of a figure | 1,000,000 | `limit` |
| Objects | 5,000 | `limit` |
| Function parameters | 4 | `limit` |
| Command arguments | 16 | `limit` |
| Text length | 10,000 characters | `limit` |
| Errors reported per line | 1 + 7 in `more` | not an error |

`limit` errors carry `limit: { name, max, got }`.

```json
{
  "ok": false, "line": 1, "col": 5, "endCol": 20, "severity": "error",
  "kind": "limit", "token": "[1..1000000]",
  "limit": { "name": "range_elements", "max": 100000, "got": 1000000 },
  "message": "That list would have 1,000,000 elements; the most one list can hold is 100,000.",
  "expected": [], "forms": [],
  "hint": "Use a smaller range, or Seq with a step, or compute the value with a formula instead of a list."
}
```

## 8. Runtime and numeric failures

These never raise errors. After each accepted line the result carries `undefined: [{ name, reason, via? }]` for objects that became undefined because of this line.

| Situation | Result |
|---|---|
| `sqrt(-1)`, `asin(2)`, `ln(0)` | undefined `out_of_domain` |
| `1/0`, `x/0`, `mod(a, 0)` | undefined `division_by_zero` |
| `10^400`, `fact(200)` | undefined `overflow` |
| `inf - inf`, `0 * inf` | undefined `not_finite` |
| `L[0]`, `L[5]` on a 3-element list | undefined `index_out_of_range` |
| `max([])` | undefined `empty_list` |
| `fact(2.5)`, `L[1.5]` | undefined `not_integer` |
| Downstream of any undefined | undefined `input_undefined`, `via` = nearest undefined input |

The `figure` tool reports `{ name, reason, via }`. The Algebra view shows the reason beside a dash.

Float details:

- Comparisons with NaN are false, except through `==` on undefined which is undefined (logic section of the design).
- Integers above 2^53 lose exactness; the literal warning `precision_loss` appears once, at definition.
- Display rounding never changes the stored value.
- Underflow to 0 is silent.
- Trigonometric arguments larger than 1e15 give accuracy warnings from the platform library: results are returned, and the AV marks the value `approx`. (Reduction is exact for arguments up to 2^52 on common platforms.)

## 9. How GeoGebra handles failures, and what we change

| Concern | GeoGebra | Ours |
|---|---|---|
| Parse failures | One generic message; position, token, expectations dropped | Full position and expectations |
| Errors reach the caller as | A dialog or an exception to the UI handler; the scripting call returns true or false | Returned as data to every caller |
| Several mistakes in one line | First one only, sometimes none | Up to 8 collected in resolve and check steps |
| Suggested repairs | Slider dialog for undefined names | `fix` and `quickFixes` on many kinds; the input bar renders them as chips; the teacher sends them as lines |
| Argument errors | "Illegal argument" plus the syntax list, no per-argument diagnosis | `problems` per argument and closest form first |
| Type errors | Names the operation only | Names both types and the nearest legal alternative |
| Redefinition failures | Rebuild from XML, then generic failure | Transaction with dependents test and a list of what would break |
| Undefined values | Shown as `?` | Shown as a dash with a reason, and `via` link |
| Locale | Messages translated by key | English in v1; every `message` is built from a template id plus fields so translation later is a lookup, and models always get English |
