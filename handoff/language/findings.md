# Language: checker findings

Checker pass 1 (pipeline step 4) at commit `d2d9d9e` on `feat/language`. Paths are under `packages/kernel/src/language/` unless given in full. State machines L1 to L14 are in `docs/state-machines.md`, section `language`.

Each finding was reproduced by calling the public API (`packages/kernel/src/language/index.ts`) from a throwaway script, which was deleted afterwards. Times are from Node 26 on the checker's machine.

Ranked by impact: security, then hangs and crashes, then wrong results, then wrong errors, then cosmetic. Fix groups are listed at the end.

Checker round 2 (pipeline step 7) at commit `3220d23`. Each fix was read in the code and the original reproduction run again from a throwaway script (deleted afterwards); the regression file `packages/kernel/test/spec/language/regressions.test.ts` was also run against `d2d9d9e`, where 59 of its 86 tests fail and every finding has at least one failing test. Result: 20 findings `closed`, LANG-SM-9 `reopened`, and three new findings, LANG-SM-22 to LANG-SM-24, `open`. Line numbers in the round 2 notes refer to `3220d23`.

Checker round 3 (pipeline step 7, final confirm round) at commit `94f9db0`. Each round 3 fix was read in the code and its reproduction run again from a throwaway script (deleted afterwards); `npx vitest run packages/kernel/test/spec` gives 1,198 of 1,198 passing, and `npm run typecheck` and `eslint` are clean. Result: LANG-SM-9, LANG-SM-22 and LANG-SM-23 `closed`; LANG-SM-24 `reopened`; three new findings, LANG-SM-25 to LANG-SM-27, `open`. Line numbers in the round 3 notes refer to `94f9db0`. This was the last fixer round (pipeline: at most 3), so the open items go to the product owner.

Checker round 4 (pipeline step 7, after the product owner's narrowed ruling SM-23 and a fourth fixer round) at commit `03d9ae2`. Each round 4 fix was read in the code and its reproduction run again from a throwaway script (deleted afterwards); every other place the compiler combines numbers was also searched and probed (built-ins, fields, text interpolation, ranges, index, comparisons, conditionals, relations, `f'(x)`, polar points, list and point literals, command and `Particles` body arguments). `npx vitest run packages/kernel/test/spec` gives 1,323 of 1,323 passing, and `npm run typecheck` and `npm run lint` are clean. Result: LANG-SM-24, LANG-SM-25, LANG-SM-26 and LANG-SM-27 `closed`; five new findings, LANG-SM-28 to LANG-SM-32, `open`; one question for the product owner under "Questions". Line numbers in the round 4 notes refer to `03d9ae2`.

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
- **status:** closed
- **fix:** Registry lookups use `own()` (`Object.hasOwn`, new in `props.ts`) in `inferField` (`check.ts`), `checkStyle` and `checkDirective` (`lines.ts`), the completion paths (`tooling.ts`) and `TYPE_ALIASES` (`types.ts`). Followed the suggested fix; registries stay plain appendable objects.
- **check (round 2):** Confirmed. `own()` (`props.ts:20`) is used for `FIELDS` and each field table (`check.ts` `inferField`), `PROPERTIES` (`lines.ts` `checkStyle`, `tooling.ts` completion), `DIRECTIVES` (`lines.ts` `checkDirective`, completion) and `TYPE_ALIASES` (`types.ts`). `b = A.constructor` and `b2 = A.toString` are `type_mismatch` and leave `b` free to define; `A with constructor = 1` is `unknown_property`; `@constructor x` and `@toString` are `unknown_directive`. No other user-keyed lookup on a plain object remains (constants, commands and functions are `Map`s). Regression tests fail on `d2d9d9e` and pass now.

## Hangs and crashes

### LANG-SM-2: `ncr` and `npr` loop as many times as the user asks, at compile time and in previews

- **Impact:** hang (main thread or the input bar) from one short line.
- **Evidence:** `builtins.ts:431` `for (let i = 1; i <= k; i++)` with `k = min(r, n - r)`, and `builtins.ts:443` `for (let i = 0; i < r; i++)`. The loop keeps going after `v` becomes infinite. Constant folding (`compile.ts:199-213`) runs it while compiling, and `preview` (`tooling.ts:103-107`) compiles on every pause in typing. Measured: `preview('k2 = ncr(100000000, 50000000)')` 444 ms, `preview('k3 = npr(100000000, 100000000)')` 255 ms; time is linear, so `ncr(1000000000000000, 500000000000000)` runs for weeks.
- **Invariant broken:** L8 and L12: folding and previews never run unbounded work.
- **Suggested fix:** stop as soon as the running product is not finite (report `overflow`); for `npr`, any `r > 170` with `n ≥ r` overflows, so refuse it up front; for `ncr`, use the log-gamma form for large `k`, or cap the loop and report `overflow`.
- **status:** closed
- **fix:** `ncr` stops at the first non-finite partial product (the products never decrease) and `npr` refuses `r > 170` up front and stops at the first infinity, so both loop at most about 600 times (`builtins.ts`).
- **check (round 2):** Confirmed. `ncr` stops at the first infinite partial product; the partial products are C(n-k+i, i) with n-k >= k, so they pass 2^1024 within about 1,030 steps whatever the input. `npr` refuses r > 170. `preview('k2 = ncr(100000000, 50000000)')` 1.4 ms (was 444 ms), `npr(1e8, 1e8)` 0.2 ms, `ncr(1e15, 5e14)` 0.15 ms, all `undefined (overflow)`. No folding runs builtins any more (LANG-SM-13), so compile time is not involved.

### LANG-SM-3: Text values can grow without bound at run time

- **Impact:** memory exhaustion (about 2 GB from 21 short lines), then a wrong reason.
- **Evidence:** `compile.ts:453-454` (`text+text`) and `compileText` (`compile.ts:343-361`) never check the length. The 10,000-character limit (errors.md section 7) is only applied to literals (`check.ts:428`). `t0 = "xxxx…"` (1,000 characters) followed by `t1 = t0 + t0`, …, `t20 = t19 + t19` took 1.5 s and the heap reached 1,971 MB; `t20` then failed inside V8 with `RangeError: Invalid string length`, which `evaluate` (`compile.ts:1010-1014`) turns into `undefined (not_finite)`.
- **Invariant broken:** L9: values stay within the documented limits; the reason names the cause.
- **Suggested fix:** in `text+text` and in `compileText`, check the result length against 10,000 before building it and `fail(env, 'limit', …)`.
- **status:** closed
- **fix:** `text+text` and `compileText` check the result length against 10,000 before building it and fail with `limit` (`compile.ts`, `MAX_TEXT_LENGTH`).
- **check (round 2):** Confirmed. `text+text` checks `a.length + b.length` before joining; `compileText` checks after each part, so a value never passes 10,000 characters by more than one part (itself at most 10,000). Doubling a 1,000-character text gives `undefined (limit)` at 16,000; 10,000 exactly is defined. `limit` is a listed undefined reason (`contracts/values.ts`).

### LANG-SM-4: Cycle test overflows the stack on a long chain

- **Impact:** crash reported as `internal`: an allowed redefinition is refused.
- **Evidence:** `lines.ts:125-142` `findPath` is recursive and copies the path at every step (`[...path, id]`). With `a0 = 1` and `a1 = a0 + 1` … `a4999 = a4998 + 1` (5,000 objects, the object limit), the redefinition `a4999 = a4998 + 2` (no cycle) returns `internal` "Something went wrong inside checking the line". The same search run on its own throws `RangeError: Maximum call stack size exceeded`. Chains of 4,000 pass on this machine; engines with smaller stacks (mobile) fail sooner. Path copying is also quadratic in the chain length.
- **Invariant broken:** L7: the test runs in bounded stack for every figure the object limit allows; an acyclic redefinition is never refused.
- **Suggested fix:** an iterative search with an explicit stack and a parent map; rebuild the path only when the target is found.
- **status:** closed
- **fix:** `findPath` is now an iterative depth-first search with an explicit stack of iterators; the path is read off the stack only when the target is found (`lines.ts`). Same visiting order, so error paths are unchanged.
- **check (round 2):** Confirmed. `findPath` (`lines.ts:132`) is iterative with an explicit iterator stack and copies the path only on a hit. The 5,000-object chain redefinition is accepted and the full-chain cycle is still found.

### LANG-SM-5: Quadratic scans over programs before any limit applies

- **Impact:** hang on large files and slow keystrokes in a script editor.
- **Evidence:**
  - `source.ts:282-288`: while a bracket is open, `splitLogicalLines` appends the next physical line and calls `bracketDepth` on the whole joined text again. `'a = max(1,\n' + '2,\n'.repeat(20000)` took 1.6 s; with 40,000 lines, 6.5 s. The 2,000-character logical-line limit is only checked later by the lexer (`lexer.ts:83`), so nothing stops the joining.
  - `tooling.ts:196-235`: `logicalStart` tries each earlier physical line as a start and, for each, rescans the lines after it and joins and rescans all lines before it. With an unclosed `(` on line 1, `complete(src, src.length, fig)` took 0.82 s for 5,000 lines and 3.0 s for 10,000 lines, on every keystroke.
- **Invariant broken:** L2 and L13: splitting is linear; limits are checked before work that grows with the joined text; cost per keystroke is bounded.
- **Suggested fix:** keep the depth (and string and comment state) running across physical lines instead of rescanning; stop joining once the logical line passes 2,000 characters (it will fail with `limit` anyway). Make `logicalStart` reuse `splitLogicalLines` on the prefix (or a single forward pass) instead of its own rule.
- **status:** closed
- **fix:** `splitLogicalLines` makes one forward pass and carries only the bracket depth from line to line; `logicalStart` in `tooling.ts` is replaced by `lastLogicalStart` (same pass, same scanner) in `source.ts`. Chose to keep joining over-long logical lines (the scan is linear and the lexer reports `limit` once) instead of cutting them, which would turn the continuation lines into separate error lines.
- **check (round 2):** Confirmed. `splitLogicalLines` and `lastLogicalStart` (`source.ts:321`, `352`) are single forward passes over `scanLineDepth`; the regression timings (20,000 continuation lines, completion under 10,000 open lines) pass on this commit and fail on `d2d9d9e` (2.0 s, 1.5 s). Cost per keystroke is now linear in the prefix length, not bounded by the current logical line; that is within budget at the 5,000-object limit.

### LANG-SM-6: Unbalanced-line suggestion re-parses itself up to 2,000 times

- **Impact:** slow parse (92 ms for a 20-character line) and about 2,000 nested stack frames; a stack overflow on small-stack engines becomes `internal`.
- **Evidence:** `parser.ts:1113-1115` calls `parseLogical(first.suggest[0])` when the first lexer error is `unbalanced` with a suggestion. The suggestion (`lexer.ts:261`) appends the closers to the end of the text. When the line ends in a comment, the closers land inside the comment, so the new line is unbalanced again with a longer suggestion, and the recursion repeats once per added character until the 2,000-character limit. `parseLine('a = max(1, 2 # note')` took 92 ms and still returns the right error.
- **Invariant broken:** L4: the suggestion is checked once; L3: the suggestion closes the brackets.
- **Suggested fix:** insert the closers before a trailing comment, and check the candidate with a non-recursive parse (pass a flag that skips the suggestion check).
- **status:** closed
- **fix:** The `unbalanced` suggestion puts the closers before a trailing comment (`lexer.ts`), and the candidate is parsed once with a `probe` flag that skips the suggestion check (`parser.ts` `parseLogical`).
- **check (round 2):** Confirmed. The `unbalanced` suggestion puts the closers before a trailing comment (`a = max(1, 2) # note`) and the candidate is parsed once with `probe = true`. `parseLine('a = max(1, 2 # note')` 0.06 ms (was 92 ms).

### LANG-SM-7: Token and nesting limits do not cover text interpolations

- **Impact:** documented limits are not enforced (robustness).
- **Evidence:** the 800-token test (`lexer.ts:96`) counts only top-level tokens; the tokens of each `{…}` part live in `parts` (`lexer.ts:484`). Each interpolation is lexed with a fresh bracket stack (`lexer.ts:109`) and parsed by a new `Parser` whose `depth` starts at 0 (`parser.ts:953`). `s = "{1+1+…+1}"` with 1,801 tokens parses `ok` (the same expression outside a text gives `limit`). 62 brackets around a text with 64 brackets inside its `{…}` (126 levels) parses `ok`. The node limit (2,000) and the line length still bound the work.
- **Invariant broken:** L3 and L4: limits cover the whole line, including interpolations.
- **Suggested fix:** count interpolation tokens into the line total, pass the outer bracket depth into `lexRange` for the part, and start the sub-parser at the outer parser's `depth`.
- **status:** closed
- **fix:** Interpolation tokens count in the line total and the nesting depth of the enclosing brackets is passed into `lexRange` for each interpolation (`lexer.ts`); the sub-parser starts at the outer parser's `depth` (`parser.ts` `strNode`).
- **check (round 2):** Confirmed. Every `push` in `lexRange` counts into `tokenTotal`, interpolations included; `lexString` passes `base + stack.length` down, and `strNode` starts the sub-parser at the outer `depth`. 1,801 tokens inside `{…}` is `limit`; 62 brackets around a text with 64 inside is `limit`.

## Wrong results

### LANG-SM-8: The line splitter and the lexer disagree about where a text ends

- **Impact:** wrong results: later lines of a program are silently merged into one failing line and never created.
- **Evidence:** `bracketDepth` (`source.ts:302-310`) resets only `inComment` at a newline and keeps `inString`, while `normalise` (`source.ts:92-97`) and the lexer (`lexer.ts:430`) end a text at the newline. Also `normalise` closes a text on `„` (`source.ts:117`) but `bracketDepth` does not (`source.ts:309`). `parseProgram('s = max(len("abc\n), 1)\nA = (1, 2)\nB = (3, 4)')` returns one entry, `unterminated_string`; `A` and `B` are lost. `splitLogicalLines('s = len("x„)\nB = (1, 2)')` gives one logical line. A learner typing an unfinished text inside a call reaches this.
- **Invariant broken:** L1 and L2: the splitter sees the same string boundaries as the lexer; a string never spans a newline.
- **Suggested fix:** in `bracketDepth`, set `inString = false` at `\n` and accept the same closing quotes as `normalise`; better, share one quote and comment scanner between `normalise`, the splitter and `logicalStart`.
- **status:** closed
- **fix:** One shared scanner `scanLineDepth` in `source.ts`: a text ends at a newline, `„` closes like the other quotes, `\` escapes, brackets inside a text or interpolation are ignored. It is used by `splitLogicalLines` and `lastLogicalStart`; `normalise` now also closes a text on `„` inside `{…}` so the three agree.
- **check (round 2):** Confirmed for the cases in the finding: `parseProgram('s = max(len("abc\n), 1)\nA = (1, 2)\nB = (3, 4)')` gives three entries and `splitLogicalLines('s = len("x„)\nB = (1, 2)')` two. One case where the three scanners still disagree (a `#rrggbb` colour after `=`) predates this fix and is filed as LANG-SM-24.

### LANG-SM-9: Style and range reads make free objects dependent

- **Impact:** wrong results: a slider with a variable bound loses its slider; a free point with a `showIf` cannot be dragged.
- **Evidence:** `checkDefine` checks the range (`lines.ts:423`) and the style (`lines.ts:426`) with the same `Checker`, so their reads go into `c.reads`; then `free = isFreeNode(c, tn)` (`lines.ts:437`, `455-457`) tests `c.reads.size === 0`. With `n = 10` and `B = (1, 1)`: `a = 3 in 0..n` checks as `free: false` with `reads: [n]`; then `a in 0..20` is refused with `not_free` "a is computed from other objects"; `a = 3 with opacity = n / 20` and `P = (1, 2) with showIf = B.x > 0` are also `free: false`, and `ScratchFigure` stores `P` as not free.
- **Invariant broken:** L5: `free` is true when the value holds its own value; style values are separate property rules (`props.ts` `expr: true`).
- **Suggested fix:** record the reads of the value expression separately from the reads of the range bounds and style values; compute `free` from the value's reads only; return the other reads in their own fields so the kernel can build property rules.
- **status:** closed
- **fix (round 3):** `Checker.apart` now saves and restores `hasCommand` as well as `reads` and `usesT` (`check.ts`), so a command call in a range bound or a style value no longer makes the object dependent.
- **check (round 3):** Confirmed. `apart` (`check.ts:217`) saves `hasCommand` with `reads` and `usesT` and restores it in `finally`; `isFreeNode` (`lines.ts:478`) is the only reader. With `A = (1, 1)`, `B = (4, 5)`: `a = 3 with opacity = Distance(A, B) / 10` is stored `free: true`; `k = 3 in 0..Distance(A, B)` is `free: true, slider: true`; `P = (1, 2) with showIf = Distance(A, B) > 1` is `free: true`; `a in 0..20` and `k in 0..20` are `rerange`. A command in the value (`d = 3 + Distance(A, B) in 0..20`) still gives `free: false`.
- **fix:** `Checker.apart('range' | 'style', …)` collects the reads of range bounds and style values separately (`check.ts`); `free` is computed from the value's reads. `CheckedLine` gains `rangeReads`, `styleReads` and `styleUsesT`, and `reads` now lists only the inputs of the value rule (the kernel design says the cycle check follows value edges only, section 9.2). `CompiledLine` carries the same three. `lines.ts` wraps the four range and style checks.
- **check (round 2):** Reopened. Plain reads are fixed: `a = 3 in 0..n`, `a = 3 with opacity = n / 20` and `P = (1, 2) with showIf = B.x > 0` are free and `reads` is empty. But `Checker.apart` (`check.ts:212`) saves and restores `reads` and `usesT` only, not `hasCommand`, which `inferCommand` (`check.ts:1060`) sets and `isFreeNode` (`lines.ts:471`) tests. Any command in a range bound or a style value still makes the object dependent. With `A = (1, 1)`, `B = (4, 5)` and a `Distance(a: Point, b: Point) -> Number` command: `a = 3 with opacity = Distance(A, B) / 10` is stored `free: false` with `reads: []` and `styleReads: [A, B]`, and `a in 0..20` is then refused with `not_free` "a is computed from other objects"; `k = 3 in 0..Distance(A, B)` is stored `free: false, slider: true` (a slider that is not free, which design 7 does not allow); `P = (1, 2) with showIf = Distance(A, B) > 1` is stored `free: false`, so `P` cannot be dragged. The regression tests use plain names only, so they pass. Suggested fix: save and restore `hasCommand` in `apart` as `usesT` is; add a regression test with a command call in a range bound and in a style value.

### LANG-SM-10: Function and relation values clobber locals in a shared Env

- **Impact:** wrong results when one `Env` evaluates several compiled lines (the flat environment of design 3.15; `createEnv`, `compileLine` and `evaluate` are public).
- **Evidence:** slots start at 0 for every line (`check.ts:175`, `221-223`). A function value writes its parameters into the locals of the `Env` it was made in (`compile.ts:927`, `942`, `952`), and a relation value writes `x` and `y` there (`compile.ts:759-760`, `764-765`). With `f(x) = 10 * x` and `g(x, y) = f(y) + x` evaluated in one `Env`, `g.call(1, 2)` returns 22 instead of 21: `f` writes `y` into slot 0 and `g` then reads slot 0 as `x`. With `k = f(y) + x == 0` in the same `Env`, `residual(1, 2)` is 22 instead of 21. `ScratchFigure` hides it by giving every entry its own `Env` (`figure.ts:177`, `191`), which gives 21.
- **Invariant broken:** L9: a call into a function value does not change the caller's locals.
- **Suggested fix:** give each call its own locals frame (save the callee's slots before writing and restore them after, or allocate a small array per call), or make slots unique per figure. Document whether an `Env` may be shared between lines.
- **status:** closed
- **fix:** Function values, `call1`, `batch` and relation `residual`/`test` put back the locals they wrote (`compile.ts`); `Env` documents that one Env may evaluate several lines (`runtime.ts`).
- **check (round 2):** Confirmed. `fv.call`, `call1`, `batch`, `residual` and `test` save the slots they write and put them back (`compile.ts`); `g.call(1, 2)` and `residual(1, 2)` in one shared `Env` give 21. An exception thrown inside a call leaves the slots written, but `evaluate` then ends the whole evaluation, and the next one rewrites every slot it reads before reading it.

### LANG-SM-11: Whether an infinity may be stored is decided per line and per evaluation, not per value

- **Impact:** wrong results: overflow is stored as `inf` instead of undefined `overflow` (ruling Q4).
- **Evidence:** `Compiler.usesInf` (`compile.ts:178`) becomes true when any `inf` constant is compiled (`compile.ts:229`) and is then used for every later builtin (`compile.ts:566`) and for the line's result (`compile.ts:930`, `943`, `953`, `963`). `env.inf` (`compile.ts:252`) stays set for the rest of the evaluation once an infinite input is read (`compile.ts:61`). `w1 = if(1 < inf, exp(1000), 0)` gives `w1 = inf`, while `w0 = if(1 < 2, exp(1000), 0)` gives `undefined (overflow)`. With `big = inf`, `w2 = if(big > 0, exp(1000), 0)` gives `inf`. Style values are compiled first (`compile.ts:907`), so an `inf` in a style item has the same effect on the value.
- **Invariant broken:** L8 and L9: `inf` provenance follows the value.
- **Suggested fix:** decide per node: a builtin's infinite result is allowed only when one of its own arguments was infinite (the `anyInf` test already in `compileBuiltin`); drop the line-wide `usesInf` and the evaluation-wide `env.inf` for that decision.
- **status:** closed
- **fix:** The line-wide `usesInf` and the evaluation-wide `Env.inf` are removed. Each Number operation (`+ - * / ^` and builtins) returns an infinity only when one of its own inputs was infinite; from finite inputs it is `overflow` (`guardInf`, `compileBuiltin` in `compile.ts`). Went one step beyond the suggestion by applying the same per-node rule to arithmetic, since `1e308 * 10` next to an `inf` had the same leak. `Env.inf` is deleted from `runtime.ts`.
- **check (round 2):** Confirmed. `Compiler.usesInf` and `Env.inf` are gone; `guardInf` (`compile.ts:83`) gives `overflow` when `+ - * / ^` make an infinity from finite inputs, and `fin` in `compileBuiltin` allows an infinite result only when an argument was infinite. `w1 = if(1 < inf, exp(1000), 0)`, `w2 = if(big > 0, exp(1000), 0)`, `1e308 * 10`, `-(1e308 * 10)`, `2^2000`, `1 / 1e-320`, `number("1e400")` are `undefined (overflow)`; `big + 1`, `sqrt(big)`, `abs(-inf)`, `Q.x` with `Q = (big, 0)` and `h(big)` are `inf`; `inf - inf` and `0 * inf` are `not_finite`. Two Number paths that never went through the old or the new guard are filed as LANG-SM-22.

### LANG-SM-12: An undefined text added to a text gives the word "undefined"

- **Impact:** wrong results: an undefined value becomes a defined text.
- **Evidence:** `compile.ts:453-454` returns `l(env) + r(env)` without testing for `undefined`. `u = if(1 > 2, "a")` then `s = u + "x"` gives `s = "undefinedx"`, defined.
- **Invariant broken:** L9: a value is undefined exactly when its reason is set (core rule: every operation involving undefined is undefined).
- **Suggested fix:** return `undefined` (with `input_undefined` if no reason is set) when either side is `undefined`.
- **status:** closed
- **fix:** `text+text` returns undefined with `input_undefined` when either side is undefined (`compile.ts`).
- **check (round 2):** Confirmed. `s = u + "x"` with `u = if(1 > 2, "a")` is `undefined (input_undefined)`; both orders tested.

### LANG-SM-13: Folded constants keep the MathLib of compile time; some builtins bypass MathLib

- **Impact:** wrong results for bit-exact replay (design 3.14 "Accuracy").
- **Evidence:** constant folding (`compile.ts:199-213`) evaluates `sin(1)` once while compiling. `setMathLib` (`builtins.ts:44-46`) affects later evaluations only. After compiling `m = sin(1)` and `m2(x) = sin(1) + 0 * x`, then `setMathLib` with a `sin` that returns 42: the old `m` still gives 0.841471 and `m2(0)` gives 0.841471, while `m` compiled again gives 42. Separately, `gamma`, `beta`, `erf` and `erfc` call `Math.*` directly (`builtins.ts:108`, `121-122`, `135`, `142`, `454-455`), function arithmetic `f^2` uses `Math.pow` (`compile.ts:502`), and range folding uses `Math.pow` (`check.ts:1601`).
- **Invariant broken:** L10: one MathLib for all results; results under two MathLibs never mix.
- **Suggested fix:** route every listed call through `M` (adding `PI`-free helpers to `MathLib` where needed), and either do not fold calls that use `M`, or make `setMathLib` invalidate compiled lines (for example a version number checked by the kernel).
- **status:** closed
- **fix:** `gamma`, `beta`, `erf`, `erfc` and the Lanczos helper call `M` (`builtins.ts`); function arithmetic `f^2` (`compile.ts`) and range folding (`check.ts`) use `getMathLib().pow`. Builtin calls, fields and `^` are no longer constant-folded (`isConstant` in `compile.ts`), so a later `setMathLib` is seen by every evaluation. Chose "do not fold" over a version number.
- **check (round 2):** Confirmed. `isConstant` (`compile.ts`) no longer folds `builtin`, `field` or `^`; the remaining folds (`+ - * /` of literals and constants, comparisons, Boolean operators) do not call the MathLib. `gamma`, `beta`, `erf`, `erfc`, `lgammaPos`, function power and `foldNumber` use the installed library. No measurable cost: `batch` of `k(x) = sin(1) * x + cos(2) * x^2` over 10^6 points takes 111 ms here against 109 ms on `d2d9d9e`.

### LANG-SM-14: `1/-2x` is read silently while `1/2x` is ambiguous

- **Impact:** wrong results: an ambiguous reading is chosen without asking (design 3.5, 3.6).
- **Evidence:** `parser.ts:672` tests only a right operand that is itself an implicit product. A signed one is a `unary` node, so `q(x) = 1/-2x` is accepted as `1/(-(2x))`; `q2(x) = 1/2x` gives `ambiguous_implicit`. `1/+2x` behaves the same.
- **Invariant broken:** L4: division by an implicit product is never read silently.
- **Suggested fix:** look through leading `unary` `+`/`-` nodes (without `paren`) for the implicit product before deciding.
- **status:** closed
- **fix:** `parseTerm` looks through leading non-parenthesised `+`/`-` before testing for an implicit product; the quick fixes keep the sign: `(1/-2) * x` and `1/(-2x)` (`parser.ts` `ambiguousDivision`).
- **check (round 2):** Confirmed. `1/-2x`, `1/+2x`, `1/--2x` and `a/-2x` are `ambiguous_implicit` with the sign kept in both quick fixes; `1/-(2x)` is accepted.

### LANG-SM-15: The matcher reuses one form's typing of an argument for every form

- **Impact:** wrong results: a call that fits a form is refused.
- **Evidence:** `valueArg` (`check.ts:1154-1171`) caches the typed node by argument index; the first form tested types it with its own element hint (`check.ts:1215`). With a table holding `Fz(a: List<Point>, b: Number)` and `Fz(a: List<Number>, b: Point)`, `n = Fz([], A)` gives `no_matching_form` ("argument 2 (b) should be a Number") although the second form fits; `n = Fz([], 1)` works. The same applies to any argument whose type depends on the hint (`[]`, a list holding only `undefined`).
- **Invariant broken:** L6: a value argument is typed with the expected type of the form it is tested against.
- **Suggested fix:** key the cache by argument index and hint (or skip the cache for arguments whose result depends on the hint).
- **status:** closed
- **fix:** The typed-argument cache in `matchForms` is keyed by argument index and expected type; diagnosis uses a typing that already exists instead of typing again (`check.ts`).
- **check (round 2):** Confirmed. The typed-argument cache is keyed by argument index and expected type; `Fz([], A)` picks the second form in either form order.

### LANG-SM-22: List arithmetic and function arithmetic bypass the overflow rule

- **Impact:** wrong results: an overflow is stored as `inf` inside a list (ruling Q4 says it is undefined `overflow`), and function arithmetic reports `not_finite` for both overflow and a real infinity.
- **Evidence:** found in round 2; present on `d2d9d9e` as well, so not caused by the LANG-SM-11 fix, but that fix states the per-value rule for "each Number operation" and these two paths do not follow it.
  - `list-num` (`compile.ts:542-554`) computes `x + k`, `x - k`, `x * k`, `x / k` and `power(x, k)` per element with no test of the result. With `L = [1, 2]`, `L2 = L * 1e308` gives `L2 = [1e308, inf]`, defined. The single-number line `q = m + m` with `m = 1e308` is `undefined (overflow)`.
  - `pointwise` (`compile.ts:927-950`) returns `NaN` with reason `not_finite` for any non-finite result. With `f(x) = x`, `g = f * f` and `h = g(1e200)`: `h = undefined (not_finite)`, where the same product written as `f(1e200) * f(1e200)` is `overflow`. With `g3 = f^2`, `g3(1e200)` is also `not_finite`. Through `pointwise`, an infinite input never gives `inf` either, while `h(big)` with `big = inf` is `inf`.
- **Invariant broken:** L8 and L9: an infinity made from finite inputs is `overflow`; an infinity that follows from an `inf` input is a value.
- **Suggested fix:** apply `guardInf` per element in `list-num` (and decide whether an overflowed element is an undefined element or makes the whole list undefined); in `pointwise`, use the same rule with `a` and `b` as the inputs.
- **status:** closed
- **fix (round 3):** `list-num` arithmetic gives undefined `overflow` for the whole list when an element overflows from finite inputs; `pointwise` (function arithmetic) gives `overflow` from finite inputs, passes an infinity that follows an infinite input as a value, and keeps `input_undefined` and `not_finite` for the rest (`compile.ts`).
- **check (round 3):** Confirmed for overflow. `list-num` (`compile.ts:544`) tests each element: an infinity from a finite element and a finite scalar fails the whole list with `overflow`; `pointwise` (`compile.ts:935`) applies the same rule with `a` and `b` as the inputs. `L2 = L * 1e308` is `undefined (overflow)`, `L4 = L * big` with `big = inf` is `[inf, inf]`, `L + 1` is `[2, 3]`; `(f * f)(1e200)` and `(f^2)(1e200)` are `overflow`, `(f * f)(big)` is `inf`, `(f - f)(big)` is `not_finite`. Making the whole list undefined is a choice the finding left open; no doc says otherwise. The same `pointwise` rule now also turns a division by zero into `overflow`, which the docs do not allow: filed as LANG-SM-25. Point and vector arithmetic has the same gap as these two paths had: filed as LANG-SM-26.

### LANG-SM-23: A slider's range may read the slider itself or its dependents

- **Impact:** wrong results, depending on how the kernel builds the range rule; needs a ruling, since no design document says whether range edges may form a cycle.
- **Evidence:** new with the LANG-SM-9 fix. `checkRedefinition` (`lines.ts:158`) runs the cycle test on `c.reads`, which no longer holds the range reads, and `checkRerange` (`lines.ts:688`) has never run it. With `a = 3 in 0..20` and `b = a + 1`: `a = 3 in 0..b` was `cycle` "a -> b -> a" on `d2d9d9e` and is now accepted; `a in 0..b` and `a in 0..a` are accepted on both commits. The kernel design (section 9.2) proves that style edges cannot form a cycle because nothing reads a style. A range is different: `slider_clamped` (language design 3.13) clamps a free number to its range, so if the kernel clamps again when a bound changes, a change to `a` changes `b`, which moves `a`'s bound, which can move `a`.
- **Invariant broken:** L7: the graph the kernel builds from a line has no cycle the update pass can loop on. Which edges count is not written down for ranges.
- **Suggested fix:** ask the product owner for a ruling. Either (a) range bounds are read only when the slider is set and never re-clamp it (then the current behaviour is right; write that in the kernel design next to 9.2), or (b) range edges count in the cycle test: run `findPath` from `reads` and `rangeReads` together in `checkRedefinition`, and run it in `checkRerange` too.
- **status:** closed
- **fix (round 3):** Ruling SM-23: the cycle test (`checkCycle` in `lines.ts`) follows the value, range and style reads together; it runs for define, function, rerange and restyle lines. `ScratchFigure` stores all three kinds of read as inputs of an object. Only the value reads decide free versus dependent.
- **check (round 3):** Confirmed for ranges. `checkCycle` (`lines.ts:163`) runs `findPath` from `reads`, `rangeReads` and `styleReads` together; `checkRedefinition`, `checkRerange` (`lines.ts:699`) and `checkRestyle` (`lines.ts:684`) call it; `ScratchFigure.apply` stores the union as the entry's inputs (`figure.ts:195`). With `a = 3 in 0..20`, `b = a + 1`: `a = 3 in 0..b`, `a in 0..b` and `a in b..20` are `cycle` "a -> b -> a"; `a in 0..a` is `cycle` "a -> a". `findPath` (`lines.ts:133`) is the iterative search of LANG-SM-4 with one `seen` set across all start points, so it cannot loop and visits each object and edge once. On a 5,000-object chain built through range edges (`a{i} = 1 in 0..a{i-1}`), style edges (`a{i} = 1 with opacity = a{i-1} / 10`) and value edges: the full-chain cycle `a0 in 0..a4999` is found in 3 to 4 ms, the acyclic `a4999 in 0..a0` is accepted in 0.1 ms, and building each chain takes 44 to 66 ms in all (linear). Free versus dependent is unchanged (`isFreeNode` reads only the value's facts). The ruling's sentence that style edges count conflicts with the kernel design and refuses lines it calls legal: filed as LANG-SM-27.

### LANG-SM-25: Division by zero in function and list arithmetic is not `division_by_zero`

- **Impact:** wrong results: function arithmetic reports `overflow` or `not_finite` for a division by zero, and a list divided by zero is stored as a defined list.
- **Evidence:** found in round 3. The `pointwise` rule of the LANG-SM-22 fix (`compile.ts:949-956`) classifies any non-finite result by its inputs only: an infinity from finite inputs is `overflow`, NaN is `not_finite`. A division by zero gives an infinity (or NaN for `0/0`) from finite inputs, so it lands in those two. errors.md section 1 (line 46) defines `division_by_zero` as "Divisor is exactly zero", and section 8 (line 333) gives `1/0` and `x/0` as undefined `division_by_zero`; the single-Number path does this (`compile.ts:449-455`), and so does `0 ^ -1` (`power`). The round 3 notes call `overflow` the new answer for this case; it was `not_finite` before, which was also wrong.
  - With `f(x) = x` and `w(x) = 0 * x`: `q = f / w`, then `q(1)` is `undefined (overflow)` and `q(0)` is `undefined (not_finite)`. `q2 = f / 0`, `q2(1)` is `overflow`. `pw = f ^ -1`, `pw(0)` is `overflow`. Written by hand, `1 / 0`, `0 / 0` and `0 ^ -1` are `division_by_zero`.
  - `list-num` (`compile.ts:552`, `560`) sets each element to NaN and calls `fail(env, 'division_by_zero')`, but returns the list: `L = [1, 2]`, `L5 = L / 0` is stored as the defined value `[undefined, undefined]`. The overflow branch of the same loop makes the whole list undefined. One operation now has two rules for a bad element.
- **Invariant broken:** L8 and L9: a Number operation that divides by exactly zero is undefined `division_by_zero` on every path; a value is undefined exactly when its reason is set.
- **Suggested fix:** in `pointwise`, test the divisor (and the base-0, negative-exponent case of `^`) before classifying, and set `division_by_zero`, ideally by sharing the single-Number operator code instead of the local `f`. In `list-num`, return `undefined` after `fail(env, 'division_by_zero')`, as the overflow branch does, unless the product owner rules that a list may hold undefined elements from arithmetic (no doc says so).
- **status:** closed
- **fix (round 4):** `pointwise` tests the divisor and the `0 ^ negative` and negative-base cases before classifying, so function arithmetic gives `division_by_zero` and `out_of_domain` like a single Number; `list-num` makes the whole list undefined on a zero divisor; one rule for every value kind (see fixer-notes, Round 4) (`compile.ts`).
- **check (round 4):** Confirmed. `pointwise` (`compile.ts:1064-1129`) clears `self.reason` on every call, returns `input_undefined` for a NaN input, then tests `b === 0` for `/` and `0 ^ negative` before computing, with the same guards and reasons as `powChecked` (`builtins.ts:572`); only then is a non-finite result classified as `not_finite` or `overflow`. `list-num` (`compile.ts:655`) returns `undefined` with `division_by_zero` before the loop. With `f(x) = x`, `w(x) = 0 * x`: `q(1)` and `q(0)` for `q = f / w`, `(f / 0)(1)` and `(f ^ -1)(0)` are all `division_by_zero`; `L / 0` with `L = [1, 2]` is `undefined (division_by_zero)`; `-f` at 2 is `-2`. Making the whole list undefined is not written in any doc (errors.md lists no list case); it matches the overflow branch and is what the tester's tests expect.

### LANG-SM-26: Point and vector arithmetic stores an infinity made from finite numbers

- **Impact:** wrong results: an overflow becomes a point or vector with an infinite coordinate (ruling Q4 says undefined `overflow`).
- **Evidence:** found in round 3; present before round 3 too (these variants never had a guard). `num*vec`, `vec*num`, `vec/num`, `vec+vec`, `pt+vec`, `vec-vec`, `pt-vec` and `pt-pt` (`compile.ts:469-505`) compute each coordinate with no `guardInf`. With `V = (1e308, 0) - (0, 0)`: `V * 10`, `10 * V`, `V / 1e-10`, `V + V` and `(1e308, 0) + V` are all stored as `(inf, 0)`, defined. The Number line `1e308 * 10` is `undefined (overflow)`. This is the gap LANG-SM-22 closed for lists and functions; the finding did not list these variants.
- **Invariant broken:** L8 and L9: an infinity made from finite inputs is `overflow`; an infinity that follows from an `inf` input is a value.
- **Suggested fix:** apply `guardInf` per coordinate (inputs: the scalar and that coordinate, or the two coordinates), and fail the whole point or vector with `overflow`, as `list-num` now does.
- **status:** closed
- **fix (round 4):** every point and vector operator applies `guardInf` per coordinate and returns an undefined value when a coordinate is not a number; the same rule now covers polar points, list and point literals, fields and `unit` (`compile.ts`, `builtins.ts`).
- **check (round 4):** Confirmed. All eight variants (`compile.ts:560-616`) build their result with `mkPt(env, guardInf(…), guardInf(…))`, and an undefined operand gives `input_undefined`. With `V = (1e308, 0) - (0, 0)`: `V * 10`, `10 * V`, `V / 1e-10`, `V + V` and `(1e308, 0) + V` are `undefined (overflow)`; `V / 0` is `division_by_zero`. With `big = inf` and `Vi = (big, 0) - (0, 0)`: `Vi * 2` is `(inf, 0)` (a value, the input was infinite) and `Vi - Vi` is `not_finite`; `(1, 2) - (3, 4)` is `(-2, -2)`. The other paths the fixer lists hold too: `(1e308 * 10; 0)` is `overflow`, `(1; big)` is `not_finite`, `[1, u]` and `[A, B]` with `u = 1 / 0` and `B = (u, 1)` are `input_undefined`; `Segment.length`, `Polygon.area` and `Polygon.perimeter` of objects with finite coordinates near 1e308 are `overflow`, `Line.point` of `0x + 0y = 1` is `division_by_zero`; `unit((1e308, 1e308) - (0, 0))` is `(0.707107, 0.707107)`, `dot` and `cross` that overflow are `overflow`. The search for paths the list left out found four: LANG-SM-28 (comparisons), LANG-SM-29 (relation coefficients), LANG-SM-30 (`hsl`, `hsv`) and LANG-SM-31 (the `:d` and `:%` text formats).

### LANG-SM-28: Every number is equal to an infinity

- **Impact:** wrong results: `==`, `!=`, `<=` and `>=` give the wrong Bool whenever one side is infinite, so `showIf`, `if(…)` and conditions that compare with a stored `inf` take the wrong branch. Ruling Q4 lets `inf` appear in any Number position, so this is reachable from ordinary lines.
- **Evidence:** found in round 4; present since pass 1 (`numEq` has not changed). `numEq` (`compile.ts:146-149`) is `a === b || |a - b| <= 1e-12 * max(1, |a|, |b|)`. With one side infinite both sides of `<=` are `inf`, so the test is true. `valueEq` (`compile.ts:151`) uses it for Numbers and per coordinate for points; `cmpNum` (`compile.ts:166`) uses it for `<=` and `>=`. With `big = inf`:
  - `5 == big`, `1e308 == big`, `-big == big` and `5 == -big` are `true`; `5 != big` is `false`.
  - `5 >= big` and `5 <= -big` are `true`.
  - `(5, 0) == (big, 0)` and `(1, 0) - (0, 0) == (big, 0) - (0, 0)` are `true`.
  - `if(5 == big, 1, 2)` is `1`.
  `<` and `>` are right (`5 < big` is `true`, `big > 5` is `true`), so `5 < big` and `5 >= big` are both true. The relation test (`compileTree`, `compile.ts:1003`) uses the same formula with `1e-9` and no `a === b` shortcut, so there an infinity is not even equal to itself.
- **Invariant broken:** L8: an operation on an infinity follows from the infinity as a value (ruling Q4). Design 3.5 (`design.md:198`) gives the tolerance formula without saying it is for finite numbers; read literally it has the same fault, so the doc needs the precondition too.
- **Suggested fix:** in `numEq`, compare exactly when either side is not finite (`if (a - a !== 0 || b - b !== 0) return a === b`), and do the same in `compileTree`; add the precondition to design 3.5. Cover Number, Point and Vector equality and the four comparison operators together.
- **status:** fixed
- **fix (round 5):** `numEq` compares exactly when either side is infinite and takes the tolerance as a parameter; the relation test in `compileTree` uses it, and the circle test in `relation.ts` requires finite coefficients (`compile.ts`, `relation.ts`).

### LANG-SM-29: A relation whose coefficients overflow stays defined, and its residual writes a reason into the caller's Env

- **Impact:** wrong results and state: a `Line`, `Circle` or `Curve` whose coefficients overflow from finite inputs is stored as a defined object with its coefficients silently dropped (ruling Q4: undefined `overflow`); and sampling any relation where its formula overflows sets `reason` on the Env it was made in, which may be evaluating another line at the time.
- **Evidence:** found in round 4; present since the LANG-SM-11 fix (round 2) made `guardInf` set a reason. The fixer notes list relation coefficients as not changed.
  - `compileRelation` (`compile.ts:947-987`) evaluates the six polynomial coefficients through the normal Number paths, so an overflow calls `fail(env, 'overflow')`, then keeps `poly` only when every coefficient is a number (`compile.ts:983`) and returns the relation either way. With `r = 1e200`, `c = x^2 + y^2 == r^2` evaluates to `defined: true` with no `poly` while `env.reason` is `overflow` after `evaluate`. `ln2 = 1e308 * 10 * x + y == 1` is checked as shape `line` and evaluates to a defined relation with no coefficients. The same `c3 = x^2 + y^2 == 4` keeps `poly` and leaves no reason. A defined value with its reason set breaks "a value is undefined exactly when its reason is set".
  - `residual` and `test` (`compile.ts:960-977`) save and restore the `x` and `y` slots but not `reason`, `via` or `detail`, unlike function values (`compile.ts:1181-1196`, which save and restore them). After `env.reason = undefined`, `c3.residual(1e200, 0)` returns `NaN` and leaves `env.reason` as `overflow`. When the kernel samples a relation inside another line's evaluation on the shared Env (design 3.15, for example a command that intersects a curve), that line gets `overflow` as its reason, or keeps it over its own reason since the first reason wins.
- **Invariant broken:** L8 (an infinity made from finite inputs is undefined `overflow` on every path) and L9 (a call into a function or relation value leaves the caller's reason and via as they were; a value is undefined exactly when its reason is set).
- **Suggested fix:** in `compileRelation`, return `undefined` (keeping the `overflow` or `not_finite` reason) when a coefficient is not a number while its inputs were finite; an infinite coefficient from an `inf` input stays a value. In `residual` and `test`, save and restore `reason`, `via` and `detail` as function values do.
- **status:** fixed
- **fix (round 5):** `compileRelation` returns an undefined relation (with the coefficient's reason, or `not_finite`) when a coefficient is not a number; `residual` and `test` save and restore `reason`, `via` and `detail` and give NaN for a difference of finite sides that overflows; function values (`call`, `call1`, `batch`) restore `via` and `detail` too (`compile.ts`).

### LANG-SM-30: `hsl` and `hsv` with an infinite hue give a defined colour with a NaN channel

- **Impact:** wrong results: a `Color` with `b: NaN` is stored as defined, and the renderer gets a channel that is not a number.
- **Evidence:** found in round 4; present since pass 1. `hslToRgb` (`builtins.ts:237-246`) starts with `h = ((h % 360) + 360) % 360`, which is NaN for an infinite `h`; `clamp` (`builtins.ts:235`) passes NaN through, and `mkColor` (`builtins.ts:255`) stores it. `compileBuiltin` (`compile.ts:757`) applies the Number rule (`fin`) only when the result is a Number, so a `Color` result is never tested. With `big = inf`: `hsl(big, 1, 0.5)` and `hsv(big, 1, 1)` are defined as `{r: 255, g: 0, b: NaN, a: 1}`. `rgb(big, 0, 0)` and `rgb(0, 0, 0, big)` are fine (clamped to 255 and 1). `hsl(1e308 * 10, 1, 0.5)` is `overflow` from its argument.
- **Invariant broken:** L8: a result that is not a number from numeric inputs (here an infinite input) is undefined `not_finite`; the pipeline rule covers every numeric value kind, which includes `Color`.
- **Suggested fix:** in `compileBuiltin`, apply the same test to a non-Number result that holds numbers (`hasNaN` / `hasNonFinite` on the result, as the field path does), or make `hsl` and `hsv` fail with `not_finite` (or `out_of_domain`) for an infinite hue.
- **status:** fixed
- **fix (round 5):** a built-in with a `call` that returns a Point, Vector, Color or list is checked number by number like a Number result: a NaN inside is undefined `not_finite`, an infinity from finite arguments is undefined `overflow`, an infinity that follows an infinite argument stays a value (`compile.ts` `nonNumberIn`).

## Wrong errors

### LANG-SM-27: Ruling SM-23 counts style edges, so a style that reads its own object is refused as a cycle

- **Impact:** wrong errors: lines that the kernel design calls legal are refused with `cycle`; needs a ruling, because ruling SM-23 and the kernel design disagree.
- **Evidence:** found in round 3; new with the LANG-SM-23 fix (accepted at `35e9177`). Ruling SM-23 ends "Range and style edges are part of the cycle test", and `checkCycle` (`lines.ts:163`) follows `styleReads` as edges, in restyle lines too (`lines.ts:694`). The kernel design, section 9.2 (`docs/features/kernel/design.md:413`), says: "Style edges can never form a cycle, because a property rule reads other objects' values and nothing reads a style. A point whose colour reads its own x, or an object whose showIf reads its own value, is therefore legal. The cycle check on lines only follows value edges." The rulings file says it wins over the language docs only, not over the kernel design. Reproduced with `P = (1, 2)` and `Q = (P.x + 1, P.y)`:
  - `P with showIf = P.x > 0` and `P with opacity = if(P.x > 0, 1, 0.5)` are `cycle` "P -> P".
  - `P = (1, 2) with showIf = P.x > 0` is `cycle` "P -> P".
  - `P with showIf = Q.x > 0` and `P = (1, 2) with opacity = Q.x / 10` are `cycle` "P -> Q -> P".
  - With `a = 3 in 0..20`: `a with opacity = a / 20` and `a = 3 in 0..20 with opacity = a / 20` (a slider that fades with its own value) are `cycle` "a -> a".
  The ruling's question (rulings row SM-23) was about ranges only; for ranges the reason holds, since `slider_clamped` lets a bound move the value. A style value has no such path back.
- **Invariant broken:** L7: a redefinition that keeps the value and range graph acyclic is never refused; style edges are not followed (kernel design 9.2).
- **Suggested fix:** ask the product owner to narrow ruling SM-23 to range edges (or to amend kernel design 9.2). If ranges only: in `checkCycle` start from `reads` and `rangeReads` only, skip the test in `checkRestyle`, and keep style reads out of the inputs `ScratchFigure` follows for the cycle test (keep them for `dependentsOf` if the kernel needs the restyle list).
- **status:** closed
- **fix (round 4):** `checkCycle` follows value and range reads only; `checkRestyle` no longer runs it and `ScratchFigure` stores value and range reads as inputs (`lines.ts`, `figure.ts`).
- **check (round 4):** Confirmed against the narrowed ruling SM-23. `checkCycle` (`lines.ts:163`) starts `findPath` from `reads` and `rangeReads`; `checkRestyle` (`lines.ts:684`) no longer calls it; `checkRerange` (`lines.ts:716`) still does; `ScratchFigure.apply` stores value and range reads as inputs (`figure.ts:185`). With `P = (1, 2)` and `Q = (P.x + 1, P.y)`: `P with showIf = P.x > 0`, `P with opacity = if(P.x > 0, 1, 0.5)`, `P = (1, 2) with showIf = P.x > 0`, `P with showIf = Q.x > 0` and `P = (1, 2) with opacity = Q.x / 10` are accepted. With `a = 3 in 0..20` and `b = a + 1`: `a with opacity = a / 20` and `a = 3 in 0..20 with opacity = a / 20` are accepted; `a = 3 in 0..b` and `a in 0..b` are still `cycle` "a -> b -> a", `a in 0..a` and `a = a + 1` "a -> a". Removing style reads from the inputs also removed style readers from the dependents test: filed as LANG-SM-32. A first definition whose style reads its own name is `unknown_name`; see "Questions".

### LANG-SM-24: A `#rrggbb` colour after `=` is a comment to the normaliser and the splitter but a name to the lexer

- **Impact:** wrong errors: a valid line gets `bad_character`, a valid continuation line is split in two, and completion after it offers start-of-line snippets.
- **Evidence:** found in round 2; present on `d2d9d9e` too. The lexer reads `#` followed by a hex colour after `=` as a `name` token (`lexer.ts:133`). `normalise` (`source.ts:141`) and `scanLineDepth` (`source.ts:309`) treat every `#` in code as the start of a comment.
  - Normaliser: `P with color = #ff0000, opacity = 1 − 0.5` is `bad_character` "The character − (U+2212) is not part of the language" at col 37, because the `−` after the colour is left as it is; `P with opacity = 1 − 0.5, color = #ff0000` is accepted.
  - Splitter: `parseProgram('P = (1, 2) with color = #ff0000, opacity = (1 +\n 2) / 4\nQ = (1, 1)')` gives three entries, `unbalanced` "( on column 44 is never closed" and `unbalanced` "Unmatched )", where the lexer sees one bracket open across the line break.
  - Cursor context: `complete('P with color = #ff0000, opacity = (1 +\n  ', …)` treats the second line as a new logical line (`lastLogicalStart`) and offers the `#` and `@` snippets.
- **Invariant broken:** L1, L2 and L13: the normaliser, the splitter and the cursor context see the same comment boundaries as the lexer.
- **Suggested fix:** move the hex-colour test into one shared helper (the previous non-space character is `=`, then `#` and 3, 4, 6 or 8 hex digits not followed by a name character, as `lexer.ts:137` tests) and call it from `normalise`, `scanLineDepth` and the lexer.
- **status:** closed
- **fix (round 4):** `hexColourLength` skips exactly the characters `normalise` rewrites to a space (set built from `REPLACE`), so the normaliser, the splitter and the lexer agree for U+2009, U+202F, U+2003, U+2002 (`source.ts`).
- **check (round 4):** Confirmed. `BLANKS` (`source.ts:32`) is the space plus every `REPLACE` key whose value is `' '` (U+00A0, tab, U+2009, U+202F, U+2003, U+2002), and `hexColourLength` (`source.ts:42`) skips exactly those, so it gives the same answer on the raw text (normaliser, `scanLineDepth`) and the normalised text (lexer). For each of the seven blanks between `=` and `#`: `P with color =<blank>#ff0000, opacity = 1 − 0.5` is accepted, `splitLogicalLines` and `parseProgram` give two logical lines for the continuation script, `tokenize` gives the same token kinds as the plain-space line, and `complete` on the continuation line offers the same list. A blank that `normalise` does not rewrite (U+3000, U+2007, U+200B) is `bad_character` at the blank itself, and all three scanners then treat the `#` as a comment, so they still agree. The set is built from `REPLACE` at module load, so the two cannot drift. Using the previous character before `=` on raw versus normalised text gives the same answer too: `≤`, `≥` and `≠` become `<=`, `>=` and `!=`, which `hexColourLength` refuses in both forms.
- **fix (round 3):** One helper `hexColourLength` (`source.ts`) decides whether a `#` after `=` is a colour; `normalise`, `scanLineDepth` and the lexer all call it, so the rest of the line is rewritten and a bracket opened after the colour continues the line.
- **check (round 3):** Reopened. The cases in the finding are fixed: `P with color = #ff0000, opacity = 1 − 0.5` is accepted, the continuation script splits into two good entries, and `#`, `==`, `<=`, `≠` before a `#` and comments after a colour behave the same in all three scanners. But the three call it on different texts. `normalise` calls it on the raw text (after NFC, `source.ts:158`), `scanLineDepth` on the raw text (`source.ts:334`, from `splitLogicalLines` and `lastLogicalStart`), and the lexer on the normalised text (`lexer.ts:135`). `hexColourLength` (`source.ts:39`) skips only space, tab and U+00A0 between `=` and `#`, while `normalise` rewrites four more blanks to a space (`REPLACE`, `source.ts:18`: U+2009 thin space, U+202F narrow no-break space, U+2003 em space, U+2002 en space). With one of those four between `=` and `#`, the normaliser and the splitter see a comment and the lexer sees a colour, as before the fix:
  - `P with color =\u202F#ff0000, opacity = 1 − 0.5` (narrow no-break space, which French typography and some editors insert before punctuation) is `bad_character` "The character − (U+2212) is not part of the language" at col 37; the normalised text keeps the `−`. Same for U+2009, U+2003 and U+2002; space, tab and U+00A0 are accepted.
  - `splitLogicalLines('P = (1, 2) with color =\u202F#ff0000, opacity = (1 +\n 2) / 4\nQ = (1, 1)')` gives three logical lines instead of two.
  - `complete('P with color =\u202F#ff0000, opacity = (1 +\n  ', …)` offers the `#` and `@` start-of-line snippets; `tokenize('P with color =\u202F#ff0000, opacity = 1 − 0.5')` reports `bad_character`.
- **Suggested fix (round 3):** make `hexColourLength` skip every character that `normalise` rewrites to a space (take the list from `REPLACE`, so the two cannot drift), or decide the colour once on the normalised text and map the result back for the splitter. Add a regression test with U+202F and U+2009 between `=` and `#`.

### LANG-SM-32: A redefinition that breaks a style rule is accepted

- **Impact:** wrong errors: a redefinition that a value or range reader would refuse with `breaks_dependents` is accepted when only a style reads the object, and the style rule is left calling the object with the wrong shape.
- **Evidence:** new with the LANG-SM-27 fix (round 4). `ScratchFigure.apply` now stores only value and range reads as an object's inputs (`figure.ts:185`), and `dependentsOf` (`figure.ts:83`) is built from those inputs, so the dependents test in `checkRedefinition` (`lines.ts:207`) no longer sees an object that reads the redefined one only in a style. With `f(x) = x`:
  - `k = f(1)`, then `f(x, y) = x + y` is `breaks_dependents`; `a = 3 in 0..f(5)`, then the same line is `breaks_dependents`.
  - `P = (1, 2) with opacity = f(1)`, then `f(x, y) = x + y` is accepted; so is `P = (1, 2)`, `P with opacity = f(1)`, then `f(x, y) = x + y`.
  At `3550111` (before round 4) `ScratchFigure` stored the style reads as inputs, so `dependentsOf` found `P` and the re-check of its source (`f(1)` against a two-parameter `f`) refused the redefinition. Language design 3.12 step 4 (`design.md:410`) re-checks "each object in A's downstream list", and kernel design 9.2 registers style edges as edges from the inputs to the owner, so the owner is downstream. Kernel design 9.2 says what happens when an input is deleted (the property rule is detached, with a warning), not when it is redefined.
- **Invariant broken:** L7: the dependents test re-checks every value, range and style reader; the cycle test follows value and range edges only. Both used to read one `inputsOf`; they now need different edge sets.
- **Suggested fix:** keep style reads as a separate edge set: `ScratchFigure` stores them apart from `inputs`, `inputsOf` (cycle test) leaves them out, and `dependentsOf` (dependents test) includes them; the kernel must keep the same split. If the product owner prefers to detach a style rule that a redefinition breaks (as on delete), write that next to kernel design 9.2 and report it as a warning instead.
- **status:** open

### LANG-SM-16: Errors inside a body argument are dropped when several forms compete

- **Impact:** wrong error: the real mistake is replaced by `no_matching_form` with `?` types.
- **Evidence:** `check.ts:1260-1270`. When `speculative` is true the body's errors are not pushed, and the `else if (speculative && errs.length > 0) invalid = true;` binds to the inner `if` inside the `for` loop (a dangling `else`), so it never runs. Later, `failedValueArgs` (`check.ts:1329-1340`) flushes only value arguments. With a table holding two `Sq(body, k, from, to)` forms (Number body and Point body), `L = Sq(k^2 + qq, k, 1, 5)` gives `no_matching_form` "Sq has no form (?, ?, Number, Number)" instead of `unknown_name` for `qq`. Seq and Map style commands with several body forms reach this.
- **Invariant broken:** L6: errors inside an argument are reported in preference to a form diagnosis.
- **Suggested fix:** keep each form's body errors; when no form passes, report the body errors of the closest form (or those common to all forms) before diagnosing; fix the `if`/`else` with braces.
- **status:** closed
- **fix:** Body errors found while several forms compete are kept per form (`Test.bodyErrors`); if no form passes, those of the form with the fewest problems are reported before any form diagnosis. The dangling `else` is replaced by braces (`check.ts`).
- **check (round 2):** Confirmed. The dangling `else` is braced; body errors are kept per form and reported from the closest failing form before any diagnosis. `L = Sq(k^2 + qq, k, 1, 5)` is `unknown_name` for `qq`.

### LANG-SM-17: `ScratchFigure.define` throws on an unknown input name

- **Impact:** crash across the package boundary (AGENTS.md: nothing throws across a package boundary).
- **Evidence:** `figure.ts:112` casts `this.byName.get(n)` to `Entry` and reads `.info`. `fig.define('zz', 'Number', 1, { inputs: ['nope'] })` throws `TypeError: Cannot read properties of undefined (reading 'info')`.
- **Invariant broken:** L11: public methods never throw.
- **Suggested fix:** skip or report unknown input names (return a `Result`, or ignore them).
- **status:** closed
- **fix:** `define` skips an input name the figure does not know (`figure.ts`).
- **check (round 2):** Confirmed. `fig.define('zz', 'Number', 1, { inputs: ['nope'] })` returns the object with no inputs.

### LANG-SM-18: Wrong line or column in several errors

- **Impact:** wrong errors (positions and hints).
- **Evidence:**
  - Leading blank lines: `parseLineInner` passes `opts.line` (`parser.ts:1099`) instead of adding `first.firstLine - 1`. `parseLine('\n\nA = (1, 2')` reports line 1, not line 3.
  - Second line: `parser.ts:1092-1093` finds the second line with `source.indexOf(second.text)` and builds the span on the first line. `parseLine('A = (1, 2)\n2')` reports line 1, col 9 (the `2` inside the first line) instead of line 2, col 1.
  - Inside `{…}`: an error at the end of the interpolation uses `this.sm.text.length` (`parser.ts:105-108`), the end of the whole line. `parseLine('s = "{1+}" + "abc"')` reports col 19 instead of the `}` at col 9.
  - Preview of an unnamed line: `previewInner` re-analyses `pvwN = ` + the trimmed text (`tooling.ts:82-88`), so columns are shifted and the temporary name leaks. `preview('(1, qq)')` reports `unknown_name` at col 12 instead of col 5; `preview('(x, 1)')` gives the hint "Write a function: pvw1(x) = (x, 1)" and the suggestion `pvw1(x) = (x, 1)`.
- **Invariant broken:** L4 and L12: errors point at the text the user typed; temporary names never reach the user.
- **Suggested fix:** pass `firstLine` through; give the "second line" error the span of the second logical line from its `firstLine`; put the sub-parser's end-of-input position at the `}`; in preview, shift error columns back by the prefix length and leading whitespace and rewrite `pvwN` in hints and suggestions (or check the expression with a synthetic target without changing the text).
- **status:** closed
- **fix:** Four positions fixed: leading blank lines pass `firstLine` through; the "second line" error points at the first character of the second logical line; the end-of-input error in an interpolation sits on its `}` (`parser.ts`); `preview` checks an unnamed line under the name the line would get, and moves error positions back onto the typed text (`tooling.ts` `shiftBack`), so no `pvwN` reaches the user.
- **check (round 2):** Confirmed. `parseLine('\n\nA = (1, 2')` reports line 3; `parseLine('A = (1, 2)\n2')` line 2, col 1; `parseLine('s = "{1+}" + "abc"')` col 9. `preview('(1, qq)')` reports col 5, `preview('   (1, qq)')` col 8 and `preview('\n  (1, qq)')` line 2, col 7, all on the `qq` typed; `preview('(x, 1)')` uses the name the line would get (`B(x) = (x, 1)`) and no `pvw` appears in the result.

### LANG-SM-19: A character outside the Basic Multilingual Plane gives two errors

- **Impact:** wrong errors (an extra error for half a character).
- **Evidence:** `lexer.ts:247-249` tests `c.codePointAt(0) > 0xffff`, but `c` is one UTF-16 unit (`text[i]`), so the test is never true: the lexer advances one unit, then reports the low surrogate on its own. `lex(new SourceMap('a😀'))` gives `bad_character` "😀 (U+1F600)" at col 2 to 4 and `bad_character` "\ude00 (U+DE00)" at col 3 to 4; `tokenize` shows both, and the bad token's span is one unit.
- **Invariant broken:** L3: one bad character gives one error.
- **Suggested fix:** use `text.codePointAt(i)` for the test and the step.
- **status:** closed
- **fix:** The lexer reads one code point and advances by its width (`lexer.ts`).
- **check (round 2):** Confirmed. `lex(new SourceMap('a😀'))` gives one `bad_character` and one two-unit `bad` token.

### LANG-SM-20: `blockedBy` is lost for names written with braced subscripts

- **Impact:** wrong errors: the later line says only "P_1 is not defined" instead of pointing at the failed line.
- **Evidence:** `targetNamesOf` (`figure.ts:220`) does not accept `_{…}`. `applyAll(['P_{1} = (1, ', 'Q = P_1 + (1, 1)'])` gives `unknown_name` without `blockedBy` on line 2; the same lines with `P_1` give `blockedBy: { line: 1, kind: 'unbalanced' }`.
- **Invariant broken:** L11: a name made by a failed line marks later readers.
- **Suggested fix:** accept the braced subscript in the regular expression and store the canonical name (`P_1`), as the lexer does (`lexer.ts:316-317`).
- **status:** closed
- **fix:** `targetNamesOf` accepts a braced subscript and stores the lexer's canonical name (`figure.ts`).
- **check (round 2):** Confirmed. `applyAll(['P_{1} = (1, ', 'Q = P_1 + (1, 1)'])` gives `blockedBy: { line: 1, kind: 'unbalanced' }` on line 2, and the reverse spelling works too.

## Cosmetic

### LANG-SM-21: `tokenize` colours nothing in a text over 2,000 characters

- **Impact:** cosmetic: a script over 2,000 characters gets no highlighting.
- **Evidence:** `tokenize` (`tooling.ts:747-748`) lexes the whole source as one line, and `lex` returns only `eof` for more than 2,000 characters (`lexer.ts:83-92`). `tokenize('a = 1\n'.repeat(400))` (2,400 characters) returns 0 tokens and one `limit` error. The returned tokens carry a `line` field, so several lines are expected.
- **Invariant broken:** L13: `tokenize` colours any text it is given.
- **Suggested fix:** split with `splitLogicalLines` and lex each logical line with its `firstLine`.
- **status:** closed
- **fix:** `tokenize` lexes each logical line with its own `firstLine` and colours them one by one (`tooling.ts` `colourLine`).
- **check (round 2):** Confirmed. `tokenize('a = 1\n'.repeat(400))` returns 1,200 tokens with columns restarting per line; one logical line over 2,000 characters still gives `limit` only.

### LANG-SM-31: The `:d` and `:%` text formats show "Infinity" for a finite number

- **Impact:** cosmetic, but a wrong text a learner sees: a finite number shows as `Infinity°` or `Infinity%`, a word the language never prints (it writes `inf`), where every other path gives undefined `overflow`.
- **Evidence:** found in round 4; present since pass 1. `formatNumber` (`runtime.ts:123-135`) tests for NaN and infinity on its input, then for `d` computes `v * 180 / Math.PI` and for `%` computes `v * 100` and prints with `toFixed`, without testing the product. With `n = 1e307`: `"{n:d}"` is `"Infinity°"` and `"{n:%}"` is `"Infinity%"`; `"{n * 100}"` is `"undefined"` (the arithmetic path), and `"{n:2}"` and `"{n:f}"` are `"1e+307"`. With `big = inf`, `"{big:d}"` is `"inf"`.
- **Invariant broken:** L8: an infinity made from finite inputs is undefined `overflow`; a text part that is undefined shows as `undefined` (L9).
- **Suggested fix:** in `formatNumber`, test the scaled value and print `undefined` when it is not finite while `v` was, or scale after formatting where possible.
- **status:** open

## Questions

### Q-R4-1: May a first definition's style read the object it defines?

- **Case:** on a figure without `P9`, `P9 = (1, 2) with showIf = P9.x > 0` is `unknown_name` "P9 is not defined" (also `c1 = (1, 2) with opacity = c1.x / 10`). On a figure where `P9` exists, the same line is accepted, and so is `P9 with showIf = P9.x > 0`. The tester chose `unknown_name` by language design 3.19 and wrote the LANG-SM-27 tests on existing objects.
- **What the docs say:** kernel design 9.2 says a point whose colour reads its own `x`, or an object whose `showIf` reads its own value, is legal, and that nothing reads a style; it does not say whether the object must exist before the line. Language design 3.19 says `a = a + 1` is `unknown_name` when `a` does not yet exist and `cycle` after; that rule is about the value (there is no mutable assignment), and its reason does not carry over to a style, which never feeds the value. Ruling SM-23 says "a style may read its own object" without naming first definitions. Neither document says how names in the `with` list of a defining line are resolved, so the docs leave this open; the code is not in conflict with a written rule, and this is not filed as a finding.
- **Why it matters:** the live teacher and saved scripts mostly write an object once, with its style on the same line, so `P = (1, 2) with color = if(P.x > 0, red, blue)` fails where the two-line form works. Kernel design 9.2 also says property rules are saved "after the object's own line, in `with` form": if that means on the defining line, a saved figure with a self-reading style fails to load into an empty figure.
- **Options:** (a) a style on a defining line may read the name being defined (resolve it to the new object; no edge is needed, since style edges never form a cycle), with the range still refused as now (`k = 3 in 0..k` is `unknown_name`, and `cycle` by ruling SM-23 once `k` exists); or (b) keep `unknown_name`, write that in 3.19, and make sure saved figures put self-reading styles on a separate `P with …` line. The checker's reading is that (a) fits kernel design 9.2 better.

## Categories with nothing found

- **Running code:** no `eval`, `new Function`, dynamic import or timers in `language/`; compiled formulas are closures over fixed node kinds.
- **Writing globals or prototypes:** nothing writes to `Object.prototype` or to a global from user text; the only reachable prototype access is the read in LANG-SM-1. `setMathLib` is a host call, not reachable from text.
- **Regular expressions:** no catastrophic backtracking found. `targetNamesOf`, `FORMAT_RE`, the `number(Text)` pattern and the colour pattern are linear on 2,000-character inputs.
- **Leaks between figures:** none of a figure's values reach another figure. Shared module state is the MathLib (by design, see LANG-SM-13) and caches of type texts and lower-cased names.
- **Command tables:** no invalid state found (L14).
- **Round 2, the fixes themselves:** no new way to run code, no new prototype read and no new unbounded loop. The new `CheckedLine` fields `rangeReads`, `styleReads` and `styleUsesT` add one state problem (LANG-SM-9 reopened, through `hasCommand`) and one open question (LANG-SM-23). The removed folding costs nothing measurable. The 10,000-character limit holds on both text paths. The per-value `inf` rule holds on `+ - * / ^` and builtins; LANG-SM-22 lists the two paths it does not reach. `styleUsesT` is true when either a range bound or a style value reads the clock, so the kernel cannot tell which of the two rules to re-run on a tick; that costs work, not correctness, and is noted in `docs/state-machines.md` L5.
- **Round 3, the fixes themselves:** no new way to run code, no new prototype read and no new unbounded loop. `checkCycle` reuses the iterative `findPath` with one `seen` set, so the wider edge set cannot loop, overflow the stack or go quadratic (5,000-object chains above). The `rangeUsesT` and `styleUsesT` split is right on every line kind tried: `k = 3 in 0..t` sets only `rangeUsesT`, `k = 3 with opacity = t / 10` only `styleUsesT`, both together set both, `k = t in 0..10` sets only `usesT`, and `a in 0..t` and `a with opacity = t / 10` set the matching flag; `compileLine` copies both (`compile.ts:1081-1082`); nothing else in the repository reads them yet. `hexColourLength` gives the same answer to all three scanners for `==`, `<=`, `≠`, a comment after a colour, a colour in a comment, a 7-digit `#`, superscripts, `π` and `∞` after a colour (the normaliser pads those with a space); the one disagreement left is LANG-SM-24. New problems: LANG-SM-25 (the `pointwise` rule turns division by zero into `overflow`), LANG-SM-26 (point and vector arithmetic, a gap of the same kind as LANG-SM-22) and LANG-SM-27 (ruling SM-23 against kernel design 9.2).
- **Round 4, the fixes themselves:** no new way to run code, no new prototype read and no new unbounded loop. `hasNonFinite` (`compile.ts:119`) recurses only into lists, typed arrays and plain objects, which are acyclic and at most two levels deep (lists of lists), and allocates nothing for a typed array. It runs on every built-in call with a `call` that returns a Number (`compile.ts:812`): `max(L)` on a 100,000-item list takes 2.1 ms per evaluation, one more linear pass over a list the call already walks. In field reads it runs on the input only when the result is not finite. `pointwise` resets `self.reason` per call, so a reason from one sample does not stick to the next. One new state problem: LANG-SM-32 (style readers left the dependents test along with the cycle test).
- **Round 4, paths outside the fixer's list:** checked against ruling Q4 and the division and undefined rules. Correct: derivative ticks (`compile.ts:841`; `f'(1.797e308)` is 1 with `f(x) = x`, `g'(1e103)` with `g(x) = x^3` is `overflow`, `f'(inf)` is `not_finite`); ranges (`compile.ts:904`; infinite bounds or a zero step are `out_of_domain`, `[-1e308..1e308]` and `[0..1 step 1e-320]` are `limit`); index (`compile.ts:877`; a non-integer or out-of-range index has its reason, an undefined item gives `input_undefined`); conditionals; `fact`; Number negation; text interpolation without a format (an undefined part prints `undefined`, `inf` prints `inf`); `norm`, `atan2`, `min`, `max`, `round`, `noise`, `perp`, `rgb`; user function calls (`compile.ts:1181-1196`, reason saved and restored). Command and `Particles` body arguments are compiled by the same `Compiler` (`compileArgs`, `compile.ts:830`), so they follow the same paths; the GPU form of `Particles` formulas (performance design, rule 4) belongs to the view area. Not correct: comparisons (LANG-SM-28), relation coefficients and sampling (LANG-SM-29), `hsl` and `hsv` (LANG-SM-30), the `:d` and `:%` formats (LANG-SM-31).
- **Known limit, not a finding:** `ScratchFigure.apply` returns restyle and rerange lines without storing them (`figure.ts:176-178`), so a style or range added with `P with …` or `a in …` is not an edge in its graph; the next cycle test on that figure misses it. The class says it is not the kernel and does not store styles; the kernel must record these edges itself.

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
| I. Round 2 | LANG-SM-9 (reopened: `hasCommand` in `apart`), LANG-SM-22 (overflow in `list-num` and `pointwise`), LANG-SM-24 (one hex-colour test shared by the three scanners) | `check.ts`, `compile.ts`, `source.ts`, `lexer.ts` |
| J. Needs a ruling first | LANG-SM-23 (closed after ruling SM-23) | product owner, then `lines.ts` |
| K. Round 3, for the product owner (fixer rounds used up) | LANG-SM-24 (reopened: four Unicode blanks between `=` and `#`), LANG-SM-25 (division by zero in function and list arithmetic), LANG-SM-26 (overflow in point and vector arithmetic) | `source.ts`, `compile.ts` |
| L. Needs a ruling first | LANG-SM-27 (closed after the narrowed ruling SM-23) | product owner, then `lines.ts`, `figure.ts` |
| M. Round 4: the number rules on the paths left out | LANG-SM-28 (equality and `<=` `>=` with an infinity; also design 3.5), LANG-SM-29 (relation coefficients; reason saved around `residual` and `test`), LANG-SM-30 (`hsl`, `hsv` and any non-Number built-in result), LANG-SM-31 (`:d` and `:%` formats) | `compile.ts`, `builtins.ts`, `runtime.ts`, `docs/features/language/design.md` |
| N. Round 4: style edges for the dependents test | LANG-SM-32 (style readers kept out of the cycle test but in the dependents test) | `figure.ts`, the kernel's graph |
| O. Question for the product owner | Q-R4-1 (a first definition's style reading its own name) | product owner, then `check.ts` or design 3.19 |
