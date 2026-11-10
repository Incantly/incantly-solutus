# Language: checker findings

Checker pass 1 (pipeline step 4) at commit `d2d9d9e` on `feat/language`. Paths are under `packages/kernel/src/language/` unless given in full. State machines L1 to L14 are in `docs/state-machines.md`, section `language`.

Each finding was reproduced by calling the public API (`packages/kernel/src/language/index.ts`) from a throwaway script, which was deleted afterwards. Times are from Node 26 on the checker's machine.

Ranked by impact: security, then hangs and crashes, then wrong results, then wrong errors, then cosmetic. Fix groups are listed at the end.

## Security

### LANG-SM-1: Registry lookups read `Object.prototype` members

- **Impact:** security (untrusted text reads prototype functions into the type system and the kernel's directive path); also leaves objects that cannot be redefined.
- **Evidence:**
  - Fields: `check.ts:847-848` does `FIELDS[t.ty.k]` then `table?.[e.field]` on plain objects. `A = (1, 2)` then `b = A.constructor` is accepted; `b` gets `type` = the `Object` constructor function and value 2.236 (`compile.ts:135` falls through to `hypot`). `b2 = A.toString` gets `type` = `Object.prototype.toString`. After that, `c = b + 1` gives the message "Cannot add a {left} and a Number." with hint "+ is not defined for a undefined", and `b = 3` is refused as `type_change` "b is a {from}; …", so `b` can never be redefined.
  - Properties: `lines.ts:293` `PROPERTIES[it.key]`. `A with constructor = 1` and `A with toString = red, hasOwnProperty = 3` check `ok` with an empty style list: no `unknown_property` error.
  - Directives: `lines.ts:727-728` `DIRECTIVES[node.name]`. `@constructor x` and `@toString` check `ok` and hand `directive: { name: 'constructor', … }` to the kernel, which will look the name up again.
  - Also `tooling.ts:579` and `tooling.ts:599` read the same objects by key (completion only).
  - `__proto__` itself cannot be written as a name (a name must start with a letter), but every other `Object.prototype` member can.
- **Invariant broken:** L5 and L10: registries answer only their own keys; every type in a typed node is a real `Ty`.
- **Suggested fix:** look up with `Object.hasOwn(table, key)` (or turn the registries into `Map`s, or objects made with `Object.create(null)`) in `inferField`, `checkStyle`, `checkDirective` and the completion paths. Keep the registries appendable by other areas.
- **status:** open

## Hangs and crashes

### LANG-SM-2: `ncr` and `npr` loop as many times as the user asks, at compile time and in previews

- **Impact:** hang (main thread or the input bar) from one short line.
- **Evidence:** `builtins.ts:431` `for (let i = 1; i <= k; i++)` with `k = min(r, n - r)`, and `builtins.ts:443` `for (let i = 0; i < r; i++)`. The loop keeps going after `v` becomes infinite. Constant folding (`compile.ts:199-213`) runs it while compiling, and `preview` (`tooling.ts:103-107`) compiles on every pause in typing. Measured: `preview('k2 = ncr(100000000, 50000000)')` 444 ms, `preview('k3 = npr(100000000, 100000000)')` 255 ms; time is linear, so `ncr(1000000000000000, 500000000000000)` runs for weeks.
- **Invariant broken:** L8 and L12: folding and previews never run unbounded work.
- **Suggested fix:** stop as soon as the running product is not finite (report `overflow`); for `npr`, any `r > 170` with `n ≥ r` overflows, so refuse it up front; for `ncr`, use the log-gamma form for large `k`, or cap the loop and report `overflow`.
- **status:** open

### LANG-SM-3: Text values can grow without bound at run time

- **Impact:** memory exhaustion (about 2 GB from 21 short lines), then a wrong reason.
- **Evidence:** `compile.ts:453-454` (`text+text`) and `compileText` (`compile.ts:343-361`) never check the length. The 10,000-character limit (errors.md section 7) is only applied to literals (`check.ts:428`). `t0 = "xxxx…"` (1,000 characters) followed by `t1 = t0 + t0`, …, `t20 = t19 + t19` took 1.5 s and the heap reached 1,971 MB; `t20` then failed inside V8 with `RangeError: Invalid string length`, which `evaluate` (`compile.ts:1010-1014`) turns into `undefined (not_finite)`.
- **Invariant broken:** L9: values stay within the documented limits; the reason names the cause.
- **Suggested fix:** in `text+text` and in `compileText`, check the result length against 10,000 before building it and `fail(env, 'limit', …)`.
- **status:** open

### LANG-SM-4: Cycle test overflows the stack on a long chain

- **Impact:** crash reported as `internal`: an allowed redefinition is refused.
- **Evidence:** `lines.ts:125-142` `findPath` is recursive and copies the path at every step (`[...path, id]`). With `a0 = 1` and `a1 = a0 + 1` … `a4999 = a4998 + 1` (5,000 objects, the object limit), the redefinition `a4999 = a4998 + 2` (no cycle) returns `internal` "Something went wrong inside checking the line". The same search run on its own throws `RangeError: Maximum call stack size exceeded`. Chains of 4,000 pass on this machine; engines with smaller stacks (mobile) fail sooner. Path copying is also quadratic in the chain length.
- **Invariant broken:** L7: the test runs in bounded stack for every figure the object limit allows; an acyclic redefinition is never refused.
- **Suggested fix:** an iterative search with an explicit stack and a parent map; rebuild the path only when the target is found.
- **status:** open

### LANG-SM-5: Quadratic scans over programs before any limit applies

- **Impact:** hang on large files and slow keystrokes in a script editor.
- **Evidence:**
  - `source.ts:282-288`: while a bracket is open, `splitLogicalLines` appends the next physical line and calls `bracketDepth` on the whole joined text again. `'a = max(1,\n' + '2,\n'.repeat(20000)` took 1.6 s; with 40,000 lines, 6.5 s. The 2,000-character logical-line limit is only checked later by the lexer (`lexer.ts:83`), so nothing stops the joining.
  - `tooling.ts:196-235`: `logicalStart` tries each earlier physical line as a start and, for each, rescans the lines after it and joins and rescans all lines before it. With an unclosed `(` on line 1, `complete(src, src.length, fig)` took 0.82 s for 5,000 lines and 3.0 s for 10,000 lines, on every keystroke.
- **Invariant broken:** L2 and L13: splitting is linear; limits are checked before work that grows with the joined text; cost per keystroke is bounded.
- **Suggested fix:** keep the depth (and string and comment state) running across physical lines instead of rescanning; stop joining once the logical line passes 2,000 characters (it will fail with `limit` anyway). Make `logicalStart` reuse `splitLogicalLines` on the prefix (or a single forward pass) instead of its own rule.
- **status:** open

### LANG-SM-6: Unbalanced-line suggestion re-parses itself up to 2,000 times

- **Impact:** slow parse (92 ms for a 20-character line) and about 2,000 nested stack frames; a stack overflow on small-stack engines becomes `internal`.
- **Evidence:** `parser.ts:1113-1115` calls `parseLogical(first.suggest[0])` when the first lexer error is `unbalanced` with a suggestion. The suggestion (`lexer.ts:261`) appends the closers to the end of the text. When the line ends in a comment, the closers land inside the comment, so the new line is unbalanced again with a longer suggestion, and the recursion repeats once per added character until the 2,000-character limit. `parseLine('a = max(1, 2 # note')` took 92 ms and still returns the right error.
- **Invariant broken:** L4: the suggestion is checked once; L3: the suggestion closes the brackets.
- **Suggested fix:** insert the closers before a trailing comment, and check the candidate with a non-recursive parse (pass a flag that skips the suggestion check).
- **status:** open

### LANG-SM-7: Token and nesting limits do not cover text interpolations

- **Impact:** documented limits are not enforced (robustness).
- **Evidence:** the 800-token test (`lexer.ts:96`) counts only top-level tokens; the tokens of each `{…}` part live in `parts` (`lexer.ts:484`). Each interpolation is lexed with a fresh bracket stack (`lexer.ts:109`) and parsed by a new `Parser` whose `depth` starts at 0 (`parser.ts:953`). `s = "{1+1+…+1}"` with 1,801 tokens parses `ok` (the same expression outside a text gives `limit`). 62 brackets around a text with 64 brackets inside its `{…}` (126 levels) parses `ok`. The node limit (2,000) and the line length still bound the work.
- **Invariant broken:** L3 and L4: limits cover the whole line, including interpolations.
- **Suggested fix:** count interpolation tokens into the line total, pass the outer bracket depth into `lexRange` for the part, and start the sub-parser at the outer parser's `depth`.
- **status:** open

## Wrong results

### LANG-SM-8: The line splitter and the lexer disagree about where a text ends

- **Impact:** wrong results: later lines of a program are silently merged into one failing line and never created.
- **Evidence:** `bracketDepth` (`source.ts:302-310`) resets only `inComment` at a newline and keeps `inString`, while `normalise` (`source.ts:92-97`) and the lexer (`lexer.ts:430`) end a text at the newline. Also `normalise` closes a text on `„` (`source.ts:117`) but `bracketDepth` does not (`source.ts:309`). `parseProgram('s = max(len("abc\n), 1)\nA = (1, 2)\nB = (3, 4)')` returns one entry, `unterminated_string`; `A` and `B` are lost. `splitLogicalLines('s = len("x„)\nB = (1, 2)')` gives one logical line. A learner typing an unfinished text inside a call reaches this.
- **Invariant broken:** L1 and L2: the splitter sees the same string boundaries as the lexer; a string never spans a newline.
- **Suggested fix:** in `bracketDepth`, set `inString = false` at `\n` and accept the same closing quotes as `normalise`; better, share one quote and comment scanner between `normalise`, the splitter and `logicalStart`.
- **status:** open

### LANG-SM-9: Style and range reads make free objects dependent

- **Impact:** wrong results: a slider with a variable bound loses its slider; a free point with a `showIf` cannot be dragged.
- **Evidence:** `checkDefine` checks the range (`lines.ts:423`) and the style (`lines.ts:426`) with the same `Checker`, so their reads go into `c.reads`; then `free = isFreeNode(c, tn)` (`lines.ts:437`, `455-457`) tests `c.reads.size === 0`. With `n = 10` and `B = (1, 1)`: `a = 3 in 0..n` checks as `free: false` with `reads: [n]`; then `a in 0..20` is refused with `not_free` "a is computed from other objects"; `a = 3 with opacity = n / 20` and `P = (1, 2) with showIf = B.x > 0` are also `free: false`, and `ScratchFigure` stores `P` as not free.
- **Invariant broken:** L5: `free` is true when the value holds its own value; style values are separate property rules (`props.ts` `expr: true`).
- **Suggested fix:** record the reads of the value expression separately from the reads of the range bounds and style values; compute `free` from the value's reads only; return the other reads in their own fields so the kernel can build property rules.
- **status:** open

### LANG-SM-10: Function and relation values clobber locals in a shared Env

- **Impact:** wrong results when one `Env` evaluates several compiled lines (the flat environment of design 3.15; `createEnv`, `compileLine` and `evaluate` are public).
- **Evidence:** slots start at 0 for every line (`check.ts:175`, `221-223`). A function value writes its parameters into the locals of the `Env` it was made in (`compile.ts:927`, `942`, `952`), and a relation value writes `x` and `y` there (`compile.ts:759-760`, `764-765`). With `f(x) = 10 * x` and `g(x, y) = f(y) + x` evaluated in one `Env`, `g.call(1, 2)` returns 22 instead of 21: `f` writes `y` into slot 0 and `g` then reads slot 0 as `x`. With `k = f(y) + x == 0` in the same `Env`, `residual(1, 2)` is 22 instead of 21. `ScratchFigure` hides it by giving every entry its own `Env` (`figure.ts:177`, `191`), which gives 21.
- **Invariant broken:** L9: a call into a function value does not change the caller's locals.
- **Suggested fix:** give each call its own locals frame (save the callee's slots before writing and restore them after, or allocate a small array per call), or make slots unique per figure. Document whether an `Env` may be shared between lines.
- **status:** open

### LANG-SM-11: Whether an infinity may be stored is decided per line and per evaluation, not per value

- **Impact:** wrong results: overflow is stored as `inf` instead of undefined `overflow` (ruling Q4).
- **Evidence:** `Compiler.usesInf` (`compile.ts:178`) becomes true when any `inf` constant is compiled (`compile.ts:229`) and is then used for every later builtin (`compile.ts:566`) and for the line's result (`compile.ts:930`, `943`, `953`, `963`). `env.inf` (`compile.ts:252`) stays set for the rest of the evaluation once an infinite input is read (`compile.ts:61`). `w1 = if(1 < inf, exp(1000), 0)` gives `w1 = inf`, while `w0 = if(1 < 2, exp(1000), 0)` gives `undefined (overflow)`. With `big = inf`, `w2 = if(big > 0, exp(1000), 0)` gives `inf`. Style values are compiled first (`compile.ts:907`), so an `inf` in a style item has the same effect on the value.
- **Invariant broken:** L8 and L9: `inf` provenance follows the value.
- **Suggested fix:** decide per node: a builtin's infinite result is allowed only when one of its own arguments was infinite (the `anyInf` test already in `compileBuiltin`); drop the line-wide `usesInf` and the evaluation-wide `env.inf` for that decision.
- **status:** open

### LANG-SM-12: An undefined text added to a text gives the word "undefined"

- **Impact:** wrong results: an undefined value becomes a defined text.
- **Evidence:** `compile.ts:453-454` returns `l(env) + r(env)` without testing for `undefined`. `u = if(1 > 2, "a")` then `s = u + "x"` gives `s = "undefinedx"`, defined.
- **Invariant broken:** L9: a value is undefined exactly when its reason is set (core rule: every operation involving undefined is undefined).
- **Suggested fix:** return `undefined` (with `input_undefined` if no reason is set) when either side is `undefined`.
- **status:** open

### LANG-SM-13: Folded constants keep the MathLib of compile time; some builtins bypass MathLib

- **Impact:** wrong results for bit-exact replay (design 3.14 "Accuracy").
- **Evidence:** constant folding (`compile.ts:199-213`) evaluates `sin(1)` once while compiling. `setMathLib` (`builtins.ts:44-46`) affects later evaluations only. After compiling `m = sin(1)` and `m2(x) = sin(1) + 0 * x`, then `setMathLib` with a `sin` that returns 42: the old `m` still gives 0.841471 and `m2(0)` gives 0.841471, while `m` compiled again gives 42. Separately, `gamma`, `beta`, `erf` and `erfc` call `Math.*` directly (`builtins.ts:108`, `121-122`, `135`, `142`, `454-455`), function arithmetic `f^2` uses `Math.pow` (`compile.ts:502`), and range folding uses `Math.pow` (`check.ts:1601`).
- **Invariant broken:** L10: one MathLib for all results; results under two MathLibs never mix.
- **Suggested fix:** route every listed call through `M` (adding `PI`-free helpers to `MathLib` where needed), and either do not fold calls that use `M`, or make `setMathLib` invalidate compiled lines (for example a version number checked by the kernel).
- **status:** open

### LANG-SM-14: `1/-2x` is read silently while `1/2x` is ambiguous

- **Impact:** wrong results: an ambiguous reading is chosen without asking (design 3.5, 3.6).
- **Evidence:** `parser.ts:672` tests only a right operand that is itself an implicit product. A signed one is a `unary` node, so `q(x) = 1/-2x` is accepted as `1/(-(2x))`; `q2(x) = 1/2x` gives `ambiguous_implicit`. `1/+2x` behaves the same.
- **Invariant broken:** L4: division by an implicit product is never read silently.
- **Suggested fix:** look through leading `unary` `+`/`-` nodes (without `paren`) for the implicit product before deciding.
- **status:** open

### LANG-SM-15: The matcher reuses one form's typing of an argument for every form

- **Impact:** wrong results: a call that fits a form is refused.
- **Evidence:** `valueArg` (`check.ts:1154-1171`) caches the typed node by argument index; the first form tested types it with its own element hint (`check.ts:1215`). With a table holding `Fz(a: List<Point>, b: Number)` and `Fz(a: List<Number>, b: Point)`, `n = Fz([], A)` gives `no_matching_form` ("argument 2 (b) should be a Number") although the second form fits; `n = Fz([], 1)` works. The same applies to any argument whose type depends on the hint (`[]`, a list holding only `undefined`).
- **Invariant broken:** L6: a value argument is typed with the expected type of the form it is tested against.
- **Suggested fix:** key the cache by argument index and hint (or skip the cache for arguments whose result depends on the hint).
- **status:** open

## Wrong errors

### LANG-SM-16: Errors inside a body argument are dropped when several forms compete

- **Impact:** wrong error: the real mistake is replaced by `no_matching_form` with `?` types.
- **Evidence:** `check.ts:1260-1270`. When `speculative` is true the body's errors are not pushed, and the `else if (speculative && errs.length > 0) invalid = true;` binds to the inner `if` inside the `for` loop (a dangling `else`), so it never runs. Later, `failedValueArgs` (`check.ts:1329-1340`) flushes only value arguments. With a table holding two `Sq(body, k, from, to)` forms (Number body and Point body), `L = Sq(k^2 + qq, k, 1, 5)` gives `no_matching_form` "Sq has no form (?, ?, Number, Number)" instead of `unknown_name` for `qq`. Seq and Map style commands with several body forms reach this.
- **Invariant broken:** L6: errors inside an argument are reported in preference to a form diagnosis.
- **Suggested fix:** keep each form's body errors; when no form passes, report the body errors of the closest form (or those common to all forms) before diagnosing; fix the `if`/`else` with braces.
- **status:** open

### LANG-SM-17: `ScratchFigure.define` throws on an unknown input name

- **Impact:** crash across the package boundary (AGENTS.md: nothing throws across a package boundary).
- **Evidence:** `figure.ts:112` casts `this.byName.get(n)` to `Entry` and reads `.info`. `fig.define('zz', 'Number', 1, { inputs: ['nope'] })` throws `TypeError: Cannot read properties of undefined (reading 'info')`.
- **Invariant broken:** L11: public methods never throw.
- **Suggested fix:** skip or report unknown input names (return a `Result`, or ignore them).
- **status:** open

### LANG-SM-18: Wrong line or column in several errors

- **Impact:** wrong errors (positions and hints).
- **Evidence:**
  - Leading blank lines: `parseLineInner` passes `opts.line` (`parser.ts:1099`) instead of adding `first.firstLine - 1`. `parseLine('\n\nA = (1, 2')` reports line 1, not line 3.
  - Second line: `parser.ts:1092-1093` finds the second line with `source.indexOf(second.text)` and builds the span on the first line. `parseLine('A = (1, 2)\n2')` reports line 1, col 9 (the `2` inside the first line) instead of line 2, col 1.
  - Inside `{…}`: an error at the end of the interpolation uses `this.sm.text.length` (`parser.ts:105-108`), the end of the whole line. `parseLine('s = "{1+}" + "abc"')` reports col 19 instead of the `}` at col 9.
  - Preview of an unnamed line: `previewInner` re-analyses `pvwN = ` + the trimmed text (`tooling.ts:82-88`), so columns are shifted and the temporary name leaks. `preview('(1, qq)')` reports `unknown_name` at col 12 instead of col 5; `preview('(x, 1)')` gives the hint "Write a function: pvw1(x) = (x, 1)" and the suggestion `pvw1(x) = (x, 1)`.
- **Invariant broken:** L4 and L12: errors point at the text the user typed; temporary names never reach the user.
- **Suggested fix:** pass `firstLine` through; give the "second line" error the span of the second logical line from its `firstLine`; put the sub-parser's end-of-input position at the `}`; in preview, shift error columns back by the prefix length and leading whitespace and rewrite `pvwN` in hints and suggestions (or check the expression with a synthetic target without changing the text).
- **status:** open

### LANG-SM-19: A character outside the Basic Multilingual Plane gives two errors

- **Impact:** wrong errors (an extra error for half a character).
- **Evidence:** `lexer.ts:247-249` tests `c.codePointAt(0) > 0xffff`, but `c` is one UTF-16 unit (`text[i]`), so the test is never true: the lexer advances one unit, then reports the low surrogate on its own. `lex(new SourceMap('a😀'))` gives `bad_character` "😀 (U+1F600)" at col 2 to 4 and `bad_character` "\ude00 (U+DE00)" at col 3 to 4; `tokenize` shows both, and the bad token's span is one unit.
- **Invariant broken:** L3: one bad character gives one error.
- **Suggested fix:** use `text.codePointAt(i)` for the test and the step.
- **status:** open

### LANG-SM-20: `blockedBy` is lost for names written with braced subscripts

- **Impact:** wrong errors: the later line says only "P_1 is not defined" instead of pointing at the failed line.
- **Evidence:** `targetNamesOf` (`figure.ts:220`) does not accept `_{…}`. `applyAll(['P_{1} = (1, ', 'Q = P_1 + (1, 1)'])` gives `unknown_name` without `blockedBy` on line 2; the same lines with `P_1` give `blockedBy: { line: 1, kind: 'unbalanced' }`.
- **Invariant broken:** L11: a name made by a failed line marks later readers.
- **Suggested fix:** accept the braced subscript in the regular expression and store the canonical name (`P_1`), as the lexer does (`lexer.ts:316-317`).
- **status:** open

## Cosmetic

### LANG-SM-21: `tokenize` colours nothing in a text over 2,000 characters

- **Impact:** cosmetic: a script over 2,000 characters gets no highlighting.
- **Evidence:** `tokenize` (`tooling.ts:747-748`) lexes the whole source as one line, and `lex` returns only `eof` for more than 2,000 characters (`lexer.ts:83-92`). `tokenize('a = 1\n'.repeat(400))` (2,400 characters) returns 0 tokens and one `limit` error. The returned tokens carry a `line` field, so several lines are expected.
- **Invariant broken:** L13: `tokenize` colours any text it is given.
- **Suggested fix:** split with `splitLogicalLines` and lex each logical line with its `firstLine`.
- **status:** open

## Categories with nothing found

- **Running code:** no `eval`, `new Function`, dynamic import or timers in `language/`; compiled formulas are closures over fixed node kinds.
- **Writing globals or prototypes:** nothing writes to `Object.prototype` or to a global from user text; the only reachable prototype access is the read in LANG-SM-1. `setMathLib` is a host call, not reachable from text.
- **Regular expressions:** no catastrophic backtracking found. `targetNamesOf`, `FORMAT_RE`, the `number(Text)` pattern and the colour pattern are linear on 2,000-character inputs.
- **Leaks between figures:** none of a figure's values reach another figure. Shared module state is the MathLib (by design, see LANG-SM-13) and caches of type texts and lower-cased names.
- **Command tables:** no invalid state found (L14).

## Fix groups

| Group | Findings | Where |
|---|---|---|
| A. Own-key lookups in registries | LANG-SM-1 | `check.ts`, `lines.ts`, `tooling.ts` |
| B. Bounded work and limits | LANG-SM-2, 3, 4, 5, 6, 7 | `builtins.ts`, `compile.ts`, `lines.ts`, `source.ts`, `tooling.ts`, `parser.ts`, `lexer.ts` |
| C. One quote and bracket scanner for normaliser, splitter and cursor context | LANG-SM-8, part of 5 | `source.ts`, `tooling.ts` |
| D. Value semantics in the compiler and Env | LANG-SM-10, 11, 12, 13 | `compile.ts`, `builtins.ts`, `check.ts` |
| E. Checker facts and the form matcher | LANG-SM-9, 15, 16 | `lines.ts`, `check.ts` |
| F. Parser reading | LANG-SM-14 | `parser.ts` |
| G. Positions and messages | LANG-SM-18, 19, 20, 21 | `parser.ts`, `tooling.ts`, `lexer.ts`, `figure.ts` |
| H. API robustness | LANG-SM-17 | `figure.ts` |
