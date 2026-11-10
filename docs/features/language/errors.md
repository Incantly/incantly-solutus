# Input language: errors

Follows section 9 of the core design: every error is data returned to the caller; nothing opens a dialog; runtime problems are undefined values with reasons, not errors.

## 1. Error object

A language error is the unified `ErrorObject` of `docs/features/errors/design.md` section 3. It carries `committed` (always `false`), `code`, `phase`, `kind`, `message`, `messageKey`, `params`, `line`, `col`, `endCol`, `token`, `expected`, `forms`, `hint`, `suggest`, `recovery`, `related`, `path`, `cause`, `fingerprint` and `severity`. This area adds optional fields.

```ts
interface LanguageErrorExtras {
  fix?: string;             // a complete replacement for THIS line, when one safe candidate exists; also suggest[0]
  quickFixes?: { label: string; lines: string[] }[];   // multi-line repairs, for the input bar
  more?: LanguageError[];   // further independent errors found in the same line (resolve and check steps only)
  after?: number;           // this line failed because an earlier line in the batch failed: that line's number (same as blockedBy.line; recovery is fix_earlier)
  problems?: ArgProblem[];  // no_matching_form: one entry per wrong argument (section 5)
  left?: string; right?: string;   // type_mismatch: the two types, as text
  limit?: { name: string; max: number; got: number };   // limit errors
}
// Unified fields worth restating: col and endCol are 1-based, in the ORIGINAL text, endCol exclusive;
// suggest is string[] (0 to 3 lines); related is string[] (object names), not spans; path is string[] for cycles.
```

Rules:

- `col` and `endCol` always refer to the text the writer sent. The lexer's offset map converts.
- `fix`, if present, is something that would pass the same checks, and it is also the first entry of `suggest`. It is never a guess between two meanings: when two readings exist, the error has `quickFixes` with both and no `fix`.
- `message` never repeats the whole `forms` list; it names the single problem.
- `hint` is always present, never empty.
- A zero-width error (something is missing) has `endCol === col` and `token === ""`; the message may say "end of line".
- One main error is reported per line, plus up to 7 more in `more` (8 in all).
- Which entry point does what: `draw` treats the lines of a batch as independent. Lines after a failed line are still tried (the teacher may have independent lines), and a line that reads a name defined by a failed line produces `unknown_name` with `after` set. The language supports this through `CheckOptions.failed` and `targetNamesOf`. `applyBatch` is atomic: it either applies every line or none (README decision 8).

### Undefined reasons (runtime, not errors)

An object whose value cannot be computed stores `{ reason, detail?, cause? }`.

| Reason | Meaning |
|---|---|
| `explicit` | The `undefined` constant, or a user `if` branch chose it |
| `condition_false` | Two-argument `if` with a false condition |
| `division_by_zero` | Divisor is exactly zero (or a reciprocal trig function hit an exact pole) |
| `out_of_domain` | Argument outside the function's domain (`sqrt(-1)`, `asin(2)`) |
| `not_finite` | Result is not a number, such as `inf - inf` or `0 * inf`, without a more specific cause. `inf` itself is a valid stored value |
| `overflow` | Finite inputs, result above the largest double (`10^400`, `fact(200)`) |
| `index_out_of_range` | List index below 1 or above the length |
| `empty_list` | `max([])`, `mean([])` and similar |
| `not_integer` | A function needing a whole number (`fact(2.5)`, list index 1.5) |
| `input_undefined` | Cascade: an input is undefined; `cause` names it |
| `no_value_yet` | A state read before its first frame (see core 7.2) |

Other areas add reasons (`parallel`, `no_root`, `no_convergence`). This area owns the ones above.

## 2. Lexical errors (step 1)

| Kind | When | GeoGebra | Ours |
|---|---|---|---|
| `bad_character` | A character not allowed outside strings and comments: other-script letters or digits, emoji, control characters | Accepts letters from nearly every script in names, which allows look-alikes; unknown characters give a generic message | `token` is the character with its code point, `hint` names the ASCII or Greek equivalent when one exists (`Cyrillic а looks like Latin a`) |
| `bad_number` | `1.2.3`, `1e999`, `1__0`, `.`, `5.` followed by a name | Fails at evaluation time with a single number-format message | Reported at lex time with a reason in `message`: `two decimal points`, `out of range`. An exponent needs digits, so `1e`, `2e` and `1e+` are not `bad_number`: `2e` is `2 * e`, and `n = 1e+` is a `syntax` error (the `+` has no operand). `0x10` is `0 * x10` |
| `unterminated_string` | Newline or end before the closing `"` | Generic input error | Points at the opening quote; `expected: ["\""]` |
| `bad_escape` | `\q` in a string | Not detected | `expected` lists `\" \\ \n \{ \}` |
| `bad_format` | `{x:q}` with an unknown format | Not applicable | `expected` lists formats |
| `limit` (line length) | Line over 2,000 characters, or over 800 tokens | None | One kind, `limit`, with the specific limit in `params` and `limit.name`; `hint` says split the line |
| `limit` (nesting) | Nesting over 64 (64 is allowed, 65 is refused) | Stack overflow possible on deep input | Refused before recursion |

Example, a smart-quote paste:

```json
{
  "ok": false, "committed": false, "code": "L005", "phase": "lex",
  "line": 1, "col": 11, "endCol": 12, "severity": "error",
  "kind": "bad_character", "token": "а",
  "message": "The character 'а' (U+0430, Cyrillic) is not allowed in a name.",
  "expected": [], "forms": [],
  "hint": "It looks like the Latin letter 'a'. Retype the line with a keyboard that types Latin letters.",
  "fix": "area = pi * r^2", "suggest": ["area = pi * r^2"], "recovery": "use_suggestion"
}
```

## 3. Parse errors (step 2)

The parser reports the position of the first token that cannot continue the line and the set of tokens that could.

| Kind | When | GeoGebra | Ours |
|---|---|---|---|
| `syntax` | Any token that no rule accepts | One message, "please check your input", position lost | `expected` has the token classes (`")"`, `"expression"`, `"name"`, `"=="`), sorted by usefulness, at most 8; `token` is the offender, or `end of line` |
| `unbalanced` | A bracket opened and not closed, or a closer with no opener, or `(` closed by `]` | A dedicated unbalanced-brackets error without position | `related` points at the matching opener or the nearest mismatch; `fix` appends the missing closers when the line otherwise parses |
| `unnamed_object` | A line is a bare object command or value (`Circle(A, 2)`, `(1, 2)`, `3 + 4`) | Creates the object and chooses a name | Refuses. `fix` is the same line with the suggested name in front (`c = Circle(A, 2)`) |
| `missing_operator` | Two operands touch where implicit multiplication is not allowed: `a b`, `(a)(b)`, `(1/2)x`, `2 3`, `x y` | Treated as a product (often what was meant, often not) | `fix` inserts `*` (`(1/2) * x`); `hint` explains that adjacent names are not multiplied. Implicit multiplication only follows a number literal |
| `ambiguous_implicit` | A number-juxtaposed term directly after `/`: `1/2x`, `a/2b` | Reads it as a product chain | No `fix`; `quickFixes` offers `1/(2x)` and `(1/2) * x` |
| `chained_comparison` | Mixed directions or chained equality: `1 < x > 0`, `a == b == c` | Accepts and builds an and-chain only for some cases | `hint` says to use `and` |
| `assign_in_expr` | `=` inside an expression (`f(x) = x = 2`, `A = (1, 2) = B`), or an equation written with `=` (`3x + 4y = 12`) | Reads as an equation | The error is at the `=` (col 9, endCol 10 for `3x + 4y = 12`) with `expected: ["=="]`. `fix` writes `==` and wraps the relation as the line kind it needs, for example `l = Line(3x + 4y == 12)`; otherwise no fix |
| `bad_range` | `in` clause with lower bound above upper, or `step <= 0`, or a bound that is not a Number expression, or a bound that is not finite (`a = 3 in 0..inf`) | Silently swaps or ignores | `message` names which test failed; `hint` says to pick a finite bound; `fix` swaps bounds when they are literals |
| `bad_directive` | Unknown or malformed `@` line | n/a | See core; `expected` lists directive names |
| `syntax` (colon label) | `A: (1, 2)` or `A := 3` | Accepts both | Not a separate kind: `syntax` with a `fix` that rewrites with `=` |

Example, an equation written with `=`:

```json
{
  "ok": false, "committed": false, "code": "L013", "phase": "parse",
  "line": 1, "col": 9, "endCol": 10, "severity": "error",
  "kind": "assign_in_expr", "token": "=",
  "message": "A line defines one object with '='; this relation between x and y needs '=='.",
  "expected": ["=="], "forms": [],
  "hint": "Name the object on the left and compare with '==': l = Line(3x + 4y == 12).",
  "fix": "l = Line(3x + 4y == 12)", "suggest": ["l = Line(3x + 4y == 12)"], "recovery": "use_suggestion",
  "quickFixes": [{ "label": "Name it l", "lines": ["l = Line(3x + 4y == 12)"] }]
}
```

Example, `syntax` with expectations:

```json
{
  "ok": false, "committed": false, "code": "L001", "phase": "parse",
  "line": 2, "col": 18, "endCol": 19, "severity": "error",
  "kind": "syntax", "token": ",",
  "message": "Unexpected ',' in a call to Circle: the argument before it is missing.",
  "expected": ["expression", ")"], "forms": [
    "Circle(center: Point, radius: Number) -> Circle",
    "Circle(center: Point, through: Point) -> Circle",
    "Circle(a: Point, b: Point, c: Point) -> Circle"
  ],
  "hint": "Write Circle(A, 2): centre first, then radius or a point on the circle.",
  "suggest": [], "recovery": "fix_line"
}
```

Example, ambiguous division:

```json
{
  "ok": false, "committed": false, "code": "L011", "phase": "parse",
  "line": 3, "col": 11, "endCol": 14, "severity": "error",
  "kind": "ambiguous_implicit", "token": "2x",
  "message": "'1/2x' can mean (1/2) * x or 1/(2x).",
  "expected": [], "forms": [],
  "hint": "Add brackets for the one you mean.",
  "suggest": ["h = (1/2) * x", "h = 1/(2x)"], "recovery": "choose",
  "quickFixes": [
    { "label": "(1/2) * x", "lines": ["h = (1/2) * x"] },
    { "label": "1/(2x)",    "lines": ["h = 1/(2x)"] }
  ]
}
```

## 4. Name errors (step 3)

| Kind | When | GeoGebra | Ours |
|---|---|---|---|
| `unknown_name` | A name that is not an object, constant, binder or parameter | Offers to create sliders, or splits into a product, or errors "undefined variable" depending on context | Always an error. `hint` names the closest existing name (edit distance, and "all parts known" for products) |
| `unknown_command` | PascalCase name not in the command table, or a command used without arguments | "Unknown command" | `hint` lists up to 3 closest commands, case-insensitive. A lower-case `circle(` is `unknown_function` with the PascalCase hint |
| `unknown_function` | Lower-case call that is not a function object or built-in | Treats as product when the name is a number | `hint` suggests the nearest built-in |
| `not_callable` | Call on an object or constant that is not a function (`a(2)`, `pi(2)`, `x(1)`, `m (x - A.x)` with `m` a Number). A name followed by `(` is always a call, never a product | Reads as a product | `fix` inserts `*` when the callee is a Number (`m * (x - A.x)`); for `x(`, `fix` writes `x * (...)` |
| `free_variable` | `x` or `y` outside a function parameter list or a relation | Creates a function silently, or undefined variable | `fix` turns the line into a function definition when exactly one free variable is used |
| `reserved_name` | Defining a command, built-in, constant, keyword or `t x y z` | "Illegal label" without saying why | `message` says which group; `hint` gives a free alternative via `suggestName` |
| `bad_name` | Name fails the name rules: leading digit, over 32 characters, trailing `_`, `P_`. A line whose first token is a number directly followed by a name and then a top-level `=` (`1a = 1`) is also `bad_name` | Accepts many odd names | Names the broken rule ("A name cannot start with a digit"); `fix` for `1a = 1` is `a1 = 1` |
| `name_taken` | `Rename` to a name in use | "Label already used" | Names the owner object |
| `duplicate_param` | `f(x, x) = …` | Not enforced | Points at the second `x` |
| `duplicate_arg` | A command named argument given twice or twice positionally and by name | Not enforced | Names the parameter |
| `not_a_binder` | A binder position got something other than a bare name (`Seq(k^2, 3, 1, 5)`) | n/a | `expected: ["name"]` |

Example, an unknown name that is a product of known names:

```json
{
  "ok": false, "committed": false, "code": "K001", "phase": "resolve",
  "line": 4, "col": 5, "endCol": 7, "severity": "error",
  "kind": "unknown_name", "token": "ab",
  "message": "There is no object called 'ab'.",
  "expected": [], "forms": [],
  "hint": "a and b both exist. Did you mean a * b?",
  "fix": "p = a * b", "suggest": ["p = a * b"], "recovery": "use_suggestion"
}
```

Example, a slider that was never made. The input bar shows the quick fix as a chip; the teacher can send the same two lines:

```json
{
  "ok": false, "committed": false, "code": "K001", "phase": "resolve",
  "line": 2, "col": 10, "endCol": 11, "severity": "error",
  "kind": "unknown_name", "token": "k",
  "message": "There is no object called 'k'.",
  "expected": [], "forms": [],
  "hint": "Make k a number first, or pick an existing name.",
  "suggest": ["k = 1 in -5..5 step 0.1", "g(x) = k * x"], "recovery": "create_first",
  "quickFixes": [{ "label": "Create slider k from -5 to 5",
                   "lines": ["k = 1 in -5..5 step 0.1", "g(x) = k * x"] }]
}
```

Example, a free variable:

```json
{
  "ok": false, "committed": false, "code": "L015", "phase": "resolve",
  "line": 1, "col": 9, "endCol": 10, "severity": "error",
  "kind": "free_variable", "token": "x",
  "message": "x is only available inside a function or an equation, and 'a' is a plain number.",
  "expected": [], "forms": [],
  "hint": "Write a function: a(x) = x + 1, or an equation: l = y == x + 1.",
  "fix": "a(x) = x + 1", "suggest": ["a(x) = x + 1"], "recovery": "use_suggestion"
}
```

## 5. Type and argument errors (step 4)

| Kind | When | GeoGebra | Ours |
|---|---|---|---|
| `type_mismatch` | An operator, field, index, `if` branch, list element or call argument of the wrong type | "Illegal addition / multiplication / comparison", no types named | `message` names both types and the operator; extra fields `left`, `right` (type names); `hint` offers the legal neighbours (`Vector(A)`, `Dilate`, `dot`) |
| `no_matching_form` | A command or built-in whose argument count fits some form but whose argument types match none | Command's "illegal argument" then the syntax list | `forms` lists all forms, closest first (forms whose count fits come first); `problems` array (below) names each wrong argument. With one wrong argument the span and `token` are that argument (`Distance(A, 5)`: col 17, token `5`); with several wrong arguments the span is the whole call |
| `type_change` | A redefinition would change the object's type | "Redefinition failed" | Both types in the message; `hint` says `Delete(A)` first, or that a different name avoids this |
| `cycle` | A redefinition makes an object depend on itself, or a slider's range reads the slider or something downstream of it (`a = 3 in 0..a`; `a = 3 in 0..b` with `b = a + 1`). Style reads never form a cycle | "Circular definition", no path | `path` lists the chain A → B → C → A; `related` lists the object names |
| `breaks_dependents` | A redefinition is legal alone but a dependent no longer type-checks | The whole construction is rebuilt and fails, message "Redefinition failed" | `related` lists the dependents' names and the message says what each would get; nothing changes |
| `empty_list_type` | `[]` where no type can be inferred | n/a | `hint`: use `Seq` or give a first element |
| `arg_count` | Wrong number of arguments for any command, built-in or function object (`f(1, 2)` for one parameter, `log(5)`) | "Illegal number of arguments" | Its own kind (`bad_arity` does not exist). The span is the whole call; `forms` lists the forms, closest first. `no_matching_form` is only for wrong types with a fitting count |
| `unit_mismatch` | Reserved for later (angles with lengths); not raised in v1 | | |

`no_matching_form` adds a `problems` field:

```ts
problems?: { argIndex: number; param?: string; expected: string; got: string; col: number; endCol: number }[];
```

Example:

```json
{
  "ok": false, "committed": false, "code": "C001", "phase": "typecheck",
  "line": 5, "col": 5, "endCol": 20, "severity": "error",
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
  "hint": "Use Circle(A, 2) for a radius, or three points.",
  "suggest": [], "recovery": "choose_form"
}
```

Example, operator on types:

```json
{
  "ok": false, "committed": false, "code": "C003", "phase": "typecheck",
  "line": 3, "col": 5, "endCol": 10, "severity": "error",
  "kind": "type_mismatch", "token": "2 * A",
  "left": "Number", "right": "Point",
  "message": "Number * Point is not defined: a point is a position, not a vector.",
  "expected": [], "forms": [],
  "hint": "To scale a position about the origin write 2 * Vector(A); to scale about a centre use Dilate(A, 2, C).",
  "suggest": ["w = 2 * Vector(A)", "A2 = Dilate(A, 2, (0, 0))"], "recovery": "rewrite",
  "quickFixes": [
    { "label": "Position vector", "lines": ["w = 2 * Vector(A)"] },
    { "label": "Dilate about O",  "lines": ["A2 = Dilate(A, 2, (0, 0))"] }
  ]
}
```

Example, a redefinition that would break something:

```json
{
  "ok": false, "committed": false, "code": "L016", "phase": "plan",
  "line": 1, "col": 1, "endCol": 14, "severity": "error",
  "kind": "breaks_dependents", "token": "f(x, y) = x*y",
  "message": "Changing f to two parameters would break 2 objects that call f with one: g(x) = f(x) + 1 would be an arg_count error, and the tangent line T uses f with one argument.",
  "expected": [], "forms": [],
  "related": ["g", "T"],
  "hint": "Redefine g and T first, or name the new function differently.",
  "suggest": [], "recovery": "choose"
}
```

Cycle example:

```json
{
  "ok": false, "committed": false, "code": "K010", "phase": "plan",
  "line": 1, "col": 1, "endCol": 10, "severity": "error",
  "kind": "cycle", "token": "a = b + 1",
  "message": "a would depend on itself through b and c: a -> b -> c -> a.",
  "expected": [], "forms": [],
  "path": ["a", "b", "c", "a"], "related": ["b", "c"],
  "hint": "Break the loop by making one of them a plain number.",
  "suggest": [], "recovery": "rewrite"
}
```

## 6. Command-specific argument errors

The command table's `describe` and `forms` give the data for all commands. Domain checks that depend on values (a radius below 0, a polygon with fewer than 3 points) are not errors: they are undefined with a reason from the command's area. The language only raises type, count and name errors.

## 7. Limits

| Limit | Value | Kind |
|---|---|---|
| Line length | 2,000 characters | `limit` |
| Tokens per line | 800 | `limit` |
| Nesting depth | 64 (64 is allowed, 65 is refused) | `limit` |
| Expression nodes per line | 2,000 | `limit` (backstop, see below) |
| Name length | 32 | `bad_name` |
| List literal elements | 10,000 | `limit` (backstop, see below) |
| Range size `[a..b]` | 100,000 elements | `limit` |
| Elements in all lists of a figure | 1,000,000 | `limit` |
| Objects | 5,000 | `limit` |
| Function parameters | 4 | `limit` |
| Command arguments | 16 | `limit` |
| Tick calls (`f'''(x)`) | 3 | `limit` |
| Rate order (`x''`) | 2 | `limit` |
| Text length | 10,000 characters | `limit` (backstop, see below) |
| Errors reported per line | 1 + 7 in `more` | not an error |

Every limit error has kind `limit`; the specific limit is in `params` and in `limit: { name, max, got }`.

The 800-token and 2,000-character caps stop a line before it can reach 2,000 expression nodes, a 10,000-element list literal or 10,000 characters of text. Those three limits are therefore backstops for values built while the figure runs (concatenated text, `Seq` results), not for text typed in a line.

```json
{
  "ok": false, "committed": false, "code": "K040", "phase": "plan",
  "line": 1, "col": 5, "endCol": 20, "severity": "error",
  "kind": "limit", "token": "[1..1000000]",
  "limit": { "name": "range_elements", "max": 100000, "got": 1000000 },
  "message": "That list would have 1,000,000 elements; the most one list can hold is 100,000.",
  "expected": [], "forms": [],
  "hint": "Use a smaller range, or Seq with a step, or compute the value with a formula instead of a list.",
  "suggest": [], "recovery": "rewrite"
}
```

## 8. Runtime and numeric failures

These never raise errors. After each accepted line the `draw` result carries `undefined: [{ name, reason, cause? }]` for objects that became undefined because of this line.

| Situation | Result |
|---|---|
| `sqrt(-1)`, `asin(2)`, `ln(0)` | undefined `out_of_domain` |
| `1/0`, `x/0`, `mod(a, 0)` | undefined `division_by_zero` |
| `10^400`, `fact(200)` | undefined `overflow` |
| `inf - inf`, `0 * inf` | undefined `not_finite` |
| `L[0]`, `L[5]` on a 3-element list | undefined `index_out_of_range` |
| `max([])` | undefined `empty_list` |
| `fact(2.5)`, `L[1.5]` | undefined `not_integer` |
| Downstream of any undefined | undefined `input_undefined`, `cause` = nearest undefined input |

The `figure` tool reports `{ name, reason, cause }`. The Algebra view shows the reason beside a dash.

Float details:

- A comparison with an undefined operand is undefined (design 3.5), never false.
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
| Undefined values | Shown as `?` | Shown as a dash with a reason, and `cause` link |
| Locale | Messages translated by key | English in v1; every `message` is built from a template id plus fields so translation later is a lookup, and models always get English |
