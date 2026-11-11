# State machines

Every explicit and implicit state machine in the code, with its states, invariants and transition tables, and the invalid states or transitions found. Written and kept up to date by each area's checker (`docs/process/pipeline.md`). One section per area.

Format for each machine:

- **Where:** file paths.
- **States:** a table of states and what each holds.
- **Invariants:** what must always be true.
- **Transitions:** a table of from, event, guard, to, and side effects.
- **Reachable invalid states or transitions:** each with evidence and a link to its entry in `handoff/<area>/findings.md`, and its status.

## kernel

_Not yet checked._

## language

Checked at commit `d2d9d9e` (pass 1), at `3220d23` (round 2, after the fixes for LANG-SM-1 to LANG-SM-21) at `94f9db0` (round 3, after the fixes for LANG-SM-9, 22, 23 and 24) at `03d9ae2` (round 4, after the narrowed ruling SM-23 and the fixes for LANG-SM-24 to 27) and at `eddcac1` (round 5, after ruling Q-R4-1 option a and the fixes for LANG-SM-28 to 32) on `feat/language`. Paths are under `packages/kernel/src/language/`. Line numbers in L5, L7, L8, L9 and L11 refer to `eddcac1`; L1 and L2 keep the numbers of `03d9ae2`, L3 those of `94f9db0` and the other machines those of `3220d23` (no change since). Findings are in `handoff/language/findings.md`. Open after round 5 (the last fixer round; listed there as known bugs): LANG-SM-33 and LANG-SM-34.

### L1. Normaliser modes

- **Where:** `source.ts` `normalise` (lines 54 to 216), `hexColourLength` (lines 42 to 51, shared with L2 and L3), `BLANKS` (line 32: the space and every `REPLACE` key rewritten to a space).
- **States:**

| State | Holds |
|---|---|
| `code` | Typographic rewrites apply (`−`, `×`, `π`, superscripts, smart quotes open a string) |
| `string` (braceDepth 0) | Characters copied; `\x` copied as a pair; `{` enters interpolation |
| `string` (braceDepth > 0) | Code rules apply inside `{…}`; nested `{`/`}` counted |
| `comment` | Characters copied to end of line |

- **Invariants:** `start[i]`/`end[i]` map every normalised index to the raw text; a newline always returns to `code`; the lexer (L3) and the splitter (L2) see the same string and comment boundaries as this machine.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | `\n` or `\r` | | `code` | braceDepth = 0; `\r\n` becomes one `\n` |
| `code` | `#` | `hexColourLength(src, i)` > 0: previous character not in `BLANKS` (space, tab, U+00A0, U+2009, U+202F, U+2003, U+2002) is a single `=` (not `==` `<=` `>=` `!=` `≠` `≤` `≥`), then 3, 4, 6 or 8 hex digits not followed by a name character | `code` | colour copied as it is; the rest of the line keeps the code rules |
| `code` | `#` | otherwise | `comment` | |
| `code` | `"` `“` `”` `„` | | `string` | pushes `"` |
| `string`/0 | `"` `“` `”` `„` | | `code` | pushes `"` |
| `string`/0 | `{` | | `string`/1 | |
| `string`/>0 | `{` / `}` | | depth ±1 | |
| `string`/>0 | `"` `“` `”` `„` | | `code` | depth = 0 (the lexer reports the open brace) |
| `code` or `string`/>0 | superscript run, REPLACE char | | same | rewrite with offset map |

- **Reachable invalid states or transitions:** none open. `hexColourLength` runs here on the raw text and in the lexer on the normalised text; because it skips exactly the characters this machine rewrites to a space, both give the same answer for every blank (a blank this machine keeps, such as U+3000, is `bad_character` before the `#` in every scanner). Closed: LANG-SM-24 (round 4), LANG-SM-8.

### L2. Logical-line splitter (continuation lines)

- **Where:** `source.ts` `scanLineDepth`, `splitLogicalLines`, `lastLogicalStart` (lines 311 to 395), on the raw text with only `\r\n` and `\r` turned into `\n`; used by `parser.ts` `parseLine` and `parseProgram`, `tooling.ts` `cursorContext` and `tokenize`.
- **States:** per physical line: `open` (bracket depth > 0 at its end, the next line joins) or `closed`. Inside `scanLineDepth`, for one physical line: `depth` (carried in from the previous line), `inString`, `braces` (interpolation depth inside a text); a comment ends the scan of the line. Only `depth` crosses a newline.
- **Invariants:** a line continues only while a round or square bracket is open (README decision 17); texts and comments are skipped exactly as the lexer skips them; a text never spans a newline; `splitLogicalLines` and `lastLogicalStart` make the same cut; one pass, each character scanned once. An over-long logical line is still joined (the lexer reports one `limit` for it).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start of line i | scan line with depth 0 | depth at end = 0 | `closed` | emit logical line |
| start of line i | scan line | depth at end > 0 and a next line exists | `open` | scan the next line with the carried depth |
| `open` | end of program | | `closed` | emit; the lexer reports `unbalanced` |
| scan | `\r` | | | `inString` = false, `braces` = 0 |
| scan | `"` `“` `”` `„` | not in a text | `inString` | |
| scan | `"` `“` `”` `„` | in a text, any `braces` | not in a text | `braces` = 0 |
| scan, in a text, `braces` = 0 | `\` | | | skip the next character |
| scan, in a text | `{` / `}` | | | `braces` ±1; brackets inside are ignored |
| scan | `#` | not in a text, `hexColourLength` > 0 | | skip the colour; the scan goes on |
| scan | `#` | not in a text, otherwise | end of line | rest of the line is a comment |
| scan | `(` `[` / `)` `]` | not in a text | | depth ±1, never below 0 |

- **Reachable invalid states or transitions:** none open. For each blank in `BLANKS` between `=` and a colour, a bracket opened after the colour continues the line, as in the lexer. Closed: LANG-SM-24 (round 4: one blank set with L1), LANG-SM-8 (text across a newline, `„`), LANG-SM-5 (quadratic rescans).

### L3. Lexer

- **Where:** `lexer.ts` `lex`, `lexRange`, `lexString`, `lexNumber`, `lexName` (lines 76 to 531), on the normalised text (L1).
- **States:** `main` loop of `lexRange(from, to, top, base)` with a bracket `stack` (`base` is the number of brackets open around an interpolation); `string` scan (`lexString`) with an interpolation sub-scan that recurses into `lexRange(top = false, base)`; `number` scan; `name` scan (with `_{…}` subscript); terminal `limit` (line too long: no tokens). A running `tokenTotal` counts every token pushed, interpolations included.
- **Invariants:** every error carries columns of the raw text; the token count (800) and nesting depth (64) cover the whole line, interpolations included; one bad character (one code point) gives one error; tokens never overlap; the `unbalanced` suggestion closes the brackets outside any trailing comment.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start | raw length > 2,000 | | `limit` | only an `eof` token |
| main | `(` `[` | base + stack < 64 | main | push |
| main | `(` `[` | base + stack = 64 | stop | `limit` error, rest of line unlexed |
| main | `)` `]` | stack empty / wrong opener | main | `unbalanced` error (pop on mismatch) |
| main | `"` | | string | carries base + stack |
| string | `{` | matching `}` before `"` or `\n` | `lexRange(top = false, base)` | tokens kept in the part, counted in `tokenTotal` |
| string | `\n` or end | | main | `unterminated_string` |
| main | `#` | `hexColourLength(text, i)` > 0 (same test as L1 and L2, run on the normalised text) | main | a `name` token `#rrggbb` |
| main | `#` | otherwise | main | `comment` token to end of line |
| main | other character | | main | one `bad` token over the whole code point + `bad_character` |
| end | | top and stack not empty | done | `unbalanced`; suggestion = text before a trailing comment + closers + the comment |
| end | | `tokenTotal` > 800 and no earlier error | done | `limit` |

- **Reachable invalid states or transitions:** none open. It runs `hexColourLength` on the normalised text and L1 and L2 on the raw text; the shared `BLANKS` set makes the answers equal. Closed: LANG-SM-24 (round 4), LANG-SM-7, LANG-SM-19, LANG-SM-6.

### L4. Parser and line-kind dispatch

- **Where:** `parser.ts` `Parser` (lines 34 to 1058), `parseLine`, `parseLineInner`, `parseLogical`, `parseProgram` (lines 1074 to 1153).
- **States:** `Parser` fields `pos`, `depth`, `callStack`, `lineHead` (`bare`, `define`, `other`), `relationLike`; exit by return or by a `Stop` exception carrying the first error. A sub-parser is created for each text interpolation and starts at the outer `depth`. `parseLogical(text, opts, probe)` tries an `unbalanced` suggestion once, with `probe = true`, which never tries a further suggestion.
- **Invariants:** depth (calls, unary signs, `not`, power chains) never exceeds 64, counted together with the interpolation it sits in; one error per line from steps 1 and 2; error columns point at the token that caused them (the end of an interpolation is its `}`); the line number of an error is the physical line it is on, leading blank lines included; division by an implicit product, signed or not, is never read silently.
- **Transitions (line kind, first tokens):**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start | `eof`/`nl`/comment | | `noop` | |
| start | `@` | | directive | words collected to end of line |
| start | name `=` (or keyword `=`) | | define | `lineHead = define` |
| start | name `,` … `=` | | defmany | |
| start | name `(` names `)` `=` | | function | |
| start | name `'`… `=` | | rate | |
| start | name `with` / name `in` | | restyle / rerange | |
| start | name `:` | | Stop | `syntax` (colon label) |
| start | digits name `=` | touching | Stop | `bad_name` (ruling Q11) |
| start | anything else | | bare expression | upper-case call left to the checker; else `unnamed_object` with a free name |
| expr | `enter()` | depth > 64 | Stop | `limit` |
| term | `/` then an operand | after stripping unparenthesised `+`/`-`, the operand is an unparenthesised implicit product | Stop | `ambiguous_implicit`; both quick fixes keep the signs |
| `parseLogical` | first lexer error is `unbalanced` with a suggestion | not `probe` | `parseLogical(suggestion, probe = true)` | suggestion dropped if the candidate fails |
| `parseLine` | more than one non-empty logical line | | error | `syntax` "a second line" at the first character of the second logical line |
| `parseLine` | one logical line | | `parseLogical` | line = `opts.line` + `firstLine` − 1 |

- **Reachable invalid states or transitions:** none open. Closed: LANG-SM-14, LANG-SM-18 (positions), LANG-SM-6, LANG-SM-7.

### L5. Checker contexts and scopes

- **Where:** `check.ts` `Checker` (lines 180 to 1651; `apart` line 222, `withSelf` line 248), `OverlayFigure` (lines 131 to 176); `lines.ts` `checkLine` (line 28), `checkStyle` (line 323), `checkDefine` (`self` at line 480), `checkFunction` (`self` at line 637); `table.ts` `SELF_ID` (line 170).
- **States:** one `Checker` per line with `fig` (the figure, or an overlay while `withSelf` runs), `errors` (cap 8), `notices`, `reads`, `usesT`, `hasCommand`, `rangeReads`, `styleReads`, `rangeUsesT`, `styleUsesT`, `scopes` (a stack of frames), `slotCount`, `nodes` (cap 2,000), `ctx`, `simpleUnknown`. `apart('range' | 'style', fn)` saves `reads`, `usesT` and `hasCommand`, runs `fn` with fresh `reads` and `usesT`, then moves what it read into `rangeReads` or `styleReads`, sets `rangeUsesT` or `styleUsesT` if `fn` read the clock, and restores all three saved fields, also when `fn` throws. Inside the style `apart`, `checkStyle` swaps `reads` once more per property, so each `CheckedStyle` carries its own `reads`, and merges them back into the style set in `finally`. `withSelf(self, fn)` replaces `fig` with an `OverlayFigure` holding only the name being defined, as an `ObjectInfo` with id `SELF_ID` (-1), and puts the old `fig` back in `finally`; `self` is made only on a first definition whose value typed without error. Frames are pushed for function parameters, relation `x`/`y`, binders and body-scope names. Exit by result, by collected errors, or by `Bail` (node limit).
- **Invariants:** a frame pushed is popped on every path; a local name resolves before constants, objects and commands; `reads` lists the inputs of the object's value rule only (kernel design 9.2: the cycle check follows value edges); `rangeReads` and `styleReads` are the inputs of the range and property rules; `free` is true exactly when the value expression reads no object, no clock and no command, whatever the range and style read (`isFreeNode`, `lines.ts:478`, reads only the value's facts); registries answer only their own keys, so every type in a typed node is a real `Ty`; slot numbers are unique within the line. `rangeUsesT` is true exactly when a range bound reads the clock and `styleUsesT` exactly when a style value does, so the kernel re-runs only the rule that reads `t`; `usesT` is the value's alone. All three reach `CompiledLine` unchanged (`compile.ts:1300-1303`). The name being defined resolves in the style list of its own first definition (ruling Q-R4-1) and nowhere else on that line: the value and the range are checked with the plain `fig`. `styleReads` lists every object a property rule reads, the line's own object included (kernel design 9.2: a self-reading style is legal and its edge is a style edge, not a cycle edge); `SELF_ID` never reaches the cycle test.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| idle | `infer(node)` | nodes ≤ 2,000 | typing | `nodes++` |
| typing | `nodes` = 2,001 | | `Bail` | one `limit` error |
| typing | name | local frame has it | `local` node | |
| typing | name | object exists | `ref` node | `reads.add` (the current set: the value's, or the one `apart` installed) |
| typing | `t`/`bt`/`beat` | | `clock` node | `usesT = true` (the value's flag, or the fresh one `apart` installed) |
| typing | command call | | `command` node | `hasCommand = true`; inside `apart` it is put back when `apart` ends |
| typing | field `.f` | `own(FIELDS, type)` and `own(table, f)` | `field` node | |
| typing | field `.f` | not an own key | error | `type_mismatch` listing the fields |
| typing | function line | | push frame | params bound to slots 0, 1, … |
| typing | relation in `x`/`y` | | push frame | `x`, `y` bound to new slots |
| define/rerange | range clause | | `apart('range')` | reads go to `rangeReads`; a clock read sets `rangeUsesT` |
| define/function/restyle | style list | | `apart('style')` | reads go to `styleReads` and, per property, to `CheckedStyle.reads`; a clock read sets `styleUsesT`; a key `own(PROPERTIES, key)` misses is `unknown_property` |
| define/function | style list | name not in the figure, value typed | `withSelf` | the name resolves to `SELF_ID`; afterwards `SELF_ID` is deleted from `styleReads` but kept in `CheckedStyle.reads` |
| define/function | style list | name not in the figure, value has an error | plain `fig` | the name in the style is `unknown_name`, as before |
| define | range clause reads the name being defined | name not in the figure | error | `unknown_name` (`k = 3 in 0..k`); `cycle` once it exists |
| directive | `@name` | not `own(DIRECTIVES, name)` and not a figure directive | error | `unknown_directive` |
| define/function | done, no errors | | redefinition check (L7) | cycle test on `reads` and `rangeReads` (ruling SM-23, narrowed) |
| rerange | done, no errors | | cycle test (L7) | on `rangeReads` |
| restyle | done, no errors | | ok | no cycle test (style edges never form a cycle) |
| done | errors > 0 | | error | first error, up to 7 in `more` |
| done | non-`Bail` exception | | `internal` | |

- **Reachable invalid states or transitions:** the `withSelf` row deletes the self read from `styleReads`, so `P9 = (1, 2) with showIf = P9.x > 0` on an empty figure has `styleReads` `[]` while the same line on a figure holding `P9` has `[id of P9]`: LANG-SM-33 (open, new with the Q-R4-1 fix). Closed: ruling Q-R4-1 (round 5: the name resolves in a first definition's style list), LANG-SM-9 (round 3: `hasCommand` saved by `apart`), LANG-SM-1.

### L6. Command and function form matcher

- **Where:** `check.ts` `matchForms`, `diagnose`, `dropSuggestions` (lines 1101 to 1560).
- **States:** `bindings` (one per form: bound, missing, extra, duplicate named); `candidates` (arity fits); `speculative` (more than one candidate); `typed` cache of value arguments keyed by argument index and expected type (errors and notices stashed), with `typedKeys` per index and `flushedArgs`; per form `Test` (problems, invalid, score, binder problems, `bodyErrors`); outcome `chosen`, `tie` (internal), `argument errors`, `body errors`, `binder errors` or `diagnosis`.
- **Invariants:** a value argument is typed with the expected type of the form it is tested against; errors inside an argument, body arguments included, are reported in preference to a form diagnosis; notices of an argument are reported once; exactly one passing form or the most specific one wins.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start | named arg repeated / unknown name | | error | `duplicate_arg` / `bad_argument` |
| start | no candidate and a duplicate named arg | | error | `duplicate_arg` |
| candidates | test each form | | tested | value args typed once per (index, expected type); bodies typed per form in a binder frame; with several candidates, body errors kept in that form's `bodyErrors` |
| tested | ≥ 1 passing | one lowest score | chosen | flush the chosen form's typings; notices of other typings only for arguments not flushed |
| tested | ≥ 1 passing | equal lowest scores | `internal` | |
| tested | none passing, some invalid | flushed value-argument errors > 0 | argument errors | |
| tested | none passing, some invalid | no value-argument errors, some `bodyErrors` | body errors | those of the failing form with fewest problems |
| tested | binder problems | | `not_a_binder` | |
| tested | otherwise | | diagnosis | `arg_count` or `no_matching_form`; argument types shown from an existing typing |

- **Reachable invalid states or transitions:** none open. Closed: LANG-SM-15, LANG-SM-16.

### L7. Redefinition, cycle and dependents check

- **Where:** `lines.ts` `findPath`, `checkCycle`, `checkRedefinition`, `parseOne` (lines 134 to 252), `checkRestyle` (line 719), `checkRerange` (line 731); `check.ts` `OverlayFigure` (lines 131 to 176, forwards `styleRulesReading`); `table.ts` `FigureView.inputsOf`, `dependentsOf`, optional `styleRulesReading`; `figure.ts` `ScratchFigure.dependentsOf` (line 102), `styleRulesReading` (line 110), `recordStyleRules` (line 246).
- **States:** `new` (object limit test), `redefine` → `type test` → `cycle test` → `dependents test` (each direct value or range dependent, by its `source`, and each stored property rule that reads the object, by its one-property restyle line, re-parsed and re-checked against an overlay with the new type) → `ok` or an error. Rerange lines run only the `cycle test`; restyle lines run none. The `cycle test` (`checkCycle`) is one iterative depth-first search over `inputsOf`, started from the line's `reads` and `rangeReads` together, with an explicit stack of iterators and one `seen` set across all start points; the path is read off the stack only on a hit. The `dependents test` walks `dependentsOf` (value and range readers) and `styleRulesReading` (property rules, one per owner and property).
- **Invariants:** a line whose value or range creates a cycle through value or range edges is refused with its path (ruling SM-23, narrowed); style edges never join the cycle test, so a style may read its own object or its dependents (kernel design 9.2); a line that keeps the value and range graph acyclic is never refused; the test visits each object and edge at most once and runs in bounded stack for every figure the object limit allows (5,000); free versus dependent is decided by the value's facts only (L5); the dependents test re-checks every value, range and style reader of the redefined object (design 3.12 step 4; style owners are downstream through their style edges, kernel design 9.2). The cycle test and the dependents test therefore need different edge sets: `inputsOf` without style edges, `dependentsOf` plus `styleRulesReading` with them; the kernel must keep the same split. A property rule's edges are exactly the reads of the current rule for that property: a later rule for the same property (from `P with …` or a redefinition with a `with` list) drops the old rule's edges, and a redefinition without a `with` list keeps them (design 3.12 step 6). A redefined object's `source`, as re-checked here, is its own rule without the `with` list (`printLineNode`); the printed text parses and checks like the typed one.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start | no existing object | size ≥ 5,000 | error | `limit` |
| start | no existing object | | ok | no cycle test (the name is not in the graph yet) |
| start | existing | kind differs | error | `type_change` |
| type ok | DFS from `reads` ∪ `rangeReads` | reaches the target | error | `cycle` with `path` and `related` |
| type ok | DFS | finishes | dependents | |
| dependents | re-check each in `dependentsOf` | fails or changes type | error | `breaks_dependents` |
| dependents | re-check each rule in `styleRulesReading` | fails | error | `breaks_dependents`, the rule's line in `related` |
| dependents | a rule read the target, then was replaced for that property | | not re-checked | its edges are gone |
| dependents | the only reader is a first definition's style that reads its own object (Q-R4-1) | | not re-checked | the rule was stored without its self read |
| rerange | `a in lo..hi` | DFS from `rangeReads` reaches `a` | error | `cycle` (`a in 0..a`, `a in 0..b` with `b = a + 1`) |
| restyle | `P with …` | checks pass | ok | no cycle test (`P with showIf = P.x > 0` is accepted) |

- **Reachable invalid states or transitions:** on an empty figure, `f(x) = x with opacity = f(1)` then `f(x, y) = x + y` is accepted, while the same style written after `f` exists makes it `breaks_dependents` (last dependents row): LANG-SM-33 (open, new with the Q-R4-1 fix). `ScratchFigure` does not store rerange lines, so their new range edges are missing from its graph (a known limit of the scratch figure, not of the check). Closed: LANG-SM-32 (round 5: property rules per property, re-checked through `styleRulesReading`), LANG-SM-27 (round 4: style edges left the cycle test), LANG-SM-23 (round 3: range edges in the cycle test, also on rerange), LANG-SM-4. Measured at `eddcac1` on 5,000 objects: the full-chain value cycle is found in 2 ms; an acyclic change and the dependents test of the chain head take 2 to 3 ms; on a chain built through style edges, redefining the head (also to read the tail) takes 3 ms and finds no cycle; 4,999 property rules that read one function are re-checked in 42 to 52 ms.

### L8. Compiler and constant folding

- **Where:** `compile.ts` `guardInf` (line 88), `hasNonFinite`, `nonNumberIn` (lines 122 to 146), `numEq`, `valueEq`, `cmpNum` (lines 167 to 200), `Compiler` (from line 264; `objId` line 268, built-in results line 843, `compileRelation` lines 983 to 1032), `pointwise` (line 1109), `compileLine` (line 1206); `relation.ts` `classify` circle test (line 207); `builtins.ts` `powChecked`, `hslToRgb`, `mkColor`; `runtime.ts` `formatNumber` (line 123).
- **States:** one `Compiler` per line, with no line-wide flags except `opts.selfId`, which `objId` uses to turn a `SELF_ID` read (Q-R4-1) into the id the kernel gave the new object. Each node is compiled raw or folded: folded only when `isConstant` holds (no object, local, clock, command, relation, range, `undef`, builtin call, field read or `^` anywhere below) and evaluating it once in a scratch `Env` sets no reason and gives a defined, non-NaN value.
- **Invariants (the arithmetic rule):** folding gives the same value evaluation would give later and never calls the MathLib, so a later `setMathLib` reaches every result; folding never runs unbounded work. On every path and for every value kind (Number, List, Function, Point, Vector, Color, the coefficients of a relation, a formatted number in a text): a division by exactly zero, or `0 ^ negative`, is undefined `division_by_zero` (errors.md sections 1 and 8); an infinity made from finite inputs is undefined `overflow`; an infinity is a value only when an input was infinite (ruling Q4); a result that is not a number from numeric inputs (`inf - inf`, `0 * inf`) is `not_finite`; an undefined operand gives `input_undefined`; a list, point or vector with any undefined part is undefined as a whole. A comparison treats an infinity as a value: it equals only an infinity of the same sign; the relative tolerance applies to finite numbers only. A built-in result that holds numbers (Point, Vector, Color, list) follows the same rule number by number. A relation whose x/y-free parts are undefined or not numbers is undefined (holds for polynomial relations only, see below).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| node | compile | `isConstant`, not a literal, constant or text | try fold | kept raw if the scratch run sets a reason or gives NaN or `undefined` |
| Number `+ - * / ^` | evaluate | result not finite, both inputs finite | undefined | `overflow` (`guardInf`), or `not_finite` for NaN |
| Number `+ - * / ^` | evaluate | result infinite, an input infinite | value | |
| Number `/`, `^` | evaluate | divisor 0, or `0 ^ negative` | undefined | `division_by_zero` |
| builtin returning a Number | evaluate | result infinite, an argument (or a number inside one) infinite | value | |
| builtin returning a Number | evaluate | result not finite otherwise | undefined | `overflow` (finite inputs) or `not_finite` |
| builtin returning an object (Point, Vector, Color, list) | evaluate | `nonNumberIn` finds a NaN | undefined | `not_finite` (`hsl(inf, 1, 0.5)`) |
| builtin returning an object | evaluate | `nonNumberIn` finds an infinity, no argument infinite | undefined | `overflow` |
| builtin returning an object | evaluate | an infinity, an argument infinite | value | `perp((inf, 1) - (0, 0))` is `(-1, inf)` |
| line | final Number result | infinite | value | (every finite-input overflow already failed) |
| line | final Number result | NaN, no reason | undefined | `not_finite` |
| `list-num` | evaluate | scalar 0 with `/`, an item undefined, or an item overflows from finite inputs | undefined | `division_by_zero`, `input_undefined` or `overflow` for the whole list |
| `list-num` | evaluate | an item infinite, the item or the scalar infinite | list | the item stays `inf` |
| list literal | evaluate | an item undefined | undefined | `input_undefined` unless a reason is set |
| `pointwise` (function arithmetic, `-f`) | call | an input NaN | `NaN` | `input_undefined` |
| `pointwise` | call | `/` by 0, `0 ^ negative` | `NaN` | `division_by_zero` |
| `pointwise` | call | negative base, fractional exponent | `NaN` | `out_of_domain` |
| `pointwise` | call | result infinite, both inputs finite / an input infinite | `NaN` / value | `overflow` / |
| `pointwise` | call | result NaN, inputs defined | `NaN` | `not_finite` |
| `num*vec` `vec*num` `vec/num` `vec+vec` `pt+vec` `vec-vec` `pt-vec` `pt-pt`, polar point | evaluate | a coordinate not finite | per coordinate `guardInf`, then `mkPt` | undefined `overflow` or `not_finite`, or the point with an `inf` coordinate when an input was infinite |
| `vec/num` | evaluate | scalar 0 | undefined | `division_by_zero` |
| field | evaluate | result not finite, the object holds only finite numbers | undefined | `overflow` or `not_finite`; `Line.point` of a line with no direction is `division_by_zero` |
| `==` `!=` `<=` `>=` (`numEq`), relation test | evaluate | a side infinite (or NaN) and `a !== b` | not equal | exact; otherwise tolerance `1e-12` (values) or `1e-9` (relations) |
| relation with a polynomial form | evaluate | a coefficient NaN (overflow, `inf - inf`, undefined input) | undefined | the coefficient's reason, else `not_finite` |
| relation with a polynomial form | evaluate | a coefficient infinite from an `inf` input | relation | `poly` kept; never classified a circle |
| relation with no polynomial form | evaluate | an x/y-free part undefined or overflowing | defined relation | nothing is evaluated until sampling, and sampling restores the reason |
| text part `{n:d}`, `{n:%}` | evaluate | `n` finite, scaled value not finite | text `undefined` for that part | Point and Vector parts per coordinate |
| `ref`, `callObj`, `tick` | compile | id is `SELF_ID` and `selfId` given | reads `selfId` | |

- **Reachable invalid states or transitions:** a relation with no polynomial form stays defined when an input is undefined or a constant overflows (row "relation with no polynomial form"; `sin(x) == u` with `u = 1 / 0`): LANG-SM-34 (open, found in round 5). Closed: LANG-SM-28 (round 5: `numEq` exact on infinities), LANG-SM-29 (round 5: polynomial coefficients), LANG-SM-30 (round 5: `nonNumberIn` on built-in results), LANG-SM-31 (round 5: scaled formats), LANG-SM-25 and LANG-SM-26 (round 4: one rule for `pointwise`, `list-num`, points, vectors, literals, fields and `unit`), LANG-SM-22, LANG-SM-11, LANG-SM-13, LANG-SM-2. Checked and following the rule: derivative ticks, ranges, index, conditionals, `fact`, Number negation, user function calls, and command and `Particles` body arguments (compiled by the same `Compiler`).

### L9. Env and evaluation

- **Where:** `runtime.ts` `Env`, `createEnv`, `resetEnv`, `fail` (lines 60 to 120); `compile.ts` `evaluate` (line 1328), function values (in `compileLine`, lines 1220 to 1278), relation values and `sample` (lines 983 to 1032), `pointwise` (line 1109).
- **States:** `Env` fields `reason`, `cause`, `detail` (first reason wins), `locals` (slot array), `t`/`bt`/`beat`, `read`. One `Env` may evaluate several compiled lines (design 3.15). A `FunctionValue` or `RelationValue` captures the `Env` it was made in; a call saves the slots it writes and the caller's `reason`, `cause` and `detail`, writes the slots, evaluates, and puts all of them back. A `pointwise` function value keeps its own `reason`, cleared at the start of each call.
- **Invariants:** an evaluation starts with `reason`, `cause`, `detail` cleared; a call into a function or relation value leaves the caller's locals, reason and cause as they were; a value is undefined exactly when its reason is set; texts stay within 10,000 characters; an undefined text in `+` gives an undefined text.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | `evaluate` | | clear | reset three fields |
| evaluating | domain problem | `reason` unset | reason set | `fail` |
| evaluating | `fv.call(xs)` | | callee running | save `env.locals[slot]` per parameter, write, evaluate, restore; save and restore `reason`, `cause`, `detail` |
| evaluating | `fv.call1(x)` / `fv.batch(xs)` | | callee running | save, write, restore the one slot; save and restore `reason`, `cause`, `detail` |
| evaluating | `pointwise` call | | callee running | `self.reason` cleared, then set to the reason of this sample |
| evaluating | `rel.residual(x, y)` / `rel.test(x, y)` | | | `sample`: save, write, restore the `x` and `y` slots and `reason`, `cause`, `detail`; `residual` is NaN when two finite sides differ by a non-finite amount |
| evaluating | relation line, polynomial form | a coefficient NaN | undefined | its reason, else `not_finite` |
| evaluating | relation line, no polynomial form | an input undefined | defined | no reason; every sample NaN (LANG-SM-34) |
| evaluating | `text + text` | either side undefined | undefined | `input_undefined` |
| evaluating | `text + text`, interpolation | result over 10,000 characters | undefined | `limit`, checked before the text is built |
| evaluating | exception | | undefined `not_finite` | slots written by an interrupted call stay written; the next evaluation writes before it reads |

- **Reachable invalid states or transitions:** a relation with no polynomial form whose input is undefined is a defined value (`sin(x) == u` with `u = 1 / 0`): LANG-SM-34 (open). `sample` has no `try`/`finally`; an exception while sampling leaves slots and reason written, but then ends the whole evaluation (the last row). Closed: LANG-SM-29 (round 5: `sample` restores the reason; polynomial coefficients), LANG-SM-25 (round 4: `L / 0` is undefined), LANG-SM-10, LANG-SM-11, LANG-SM-12, LANG-SM-3.

### L10. Module-level mutable state

- **Where:** `builtins.ts` `M` with `setMathLib`/`getMathLib` (lines 41 to 49), `dv` (line 221); `types.ts` `setCache` (line 99); `tooling.ts` `lowerCache` (line 385, cleared at 50,000); registries `check.ts` `FIELDS`, `props.ts` `PROPERTIES` and `DIRECTIVES`, `types.ts` `TYPE_ALIASES` (plain objects other areas append to), read through `own` (`props.ts` line 20).
- **States:** MathLib `platform` or `replaced`; caches empty or filled.
- **Invariants:** every evaluation of every figure uses one MathLib, read at evaluation time (no folded result holds an older one); registries answer only their own keys.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| platform | `setMathLib(lib)` | | replaced | all figures, all later evaluations, including lines compiled before |
| registry | lookup `own(R, key)` | key not an own property | miss | an `Object.prototype` member is never returned |

- **Reachable invalid states or transitions:** none open. Closed: LANG-SM-1, LANG-SM-13.

### L11. ScratchFigure

- **Where:** `figure.ts` `ScratchFigure` (lines 70 to 272; `dependentsOf` line 102, `styleRulesReading` line 110, `define` keeps `styleRules`, `apply` lines 194 to 239, `recordStyleRules` line 246), `withoutStyle` (line 279), `targetNamesOf` (line 295).
- **States:** entries by name and id, `order`, `nextId`, `clockState`; each entry has `value`, `inputs` (the union of the line's `reads` and `rangeReads`: the edges the cycle test of L7 follows), `styleRules` (a map from property to `{ source, reads }`, one rule per property, only for rules that read an object), `info.source` (the defining line printed without its `with` list), optional `compiled` and its own `env`. `applyAll` keeps a `failed` map of names a failed line would have made.
- **Invariants:** public methods never throw; a name made by a failed line, braced subscripts included, marks later readers with `blockedBy`; `free` is what the checker said; `inputsOf` holds value and range edges (cycle test); `dependentsOf` lists value and range readers and `styleRulesReading` the property rules that read an object (dependents test, L7); a property's rule is the last one set for it, from any line kind; a line gives an object the same edges whether the object existed before or not; `compileLine` gets `selfId` = the id `define` is about to give.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| absent | `apply` define/function | checks pass | present | evaluated with a new Env kept on the entry; `inputs` = value and range reads; each style item replaces `styleRules[key]` (stored only if it reads an object other than `SELF_ID`) |
| present | `apply` restyle | checks pass | present | each item replaces `styleRules[key]`; a rule that reads nothing only removes the old one |
| any | `apply` rerange | checks pass | unchanged | returned as applied, nothing stored: the new range edges are not in `inputs` |
| present | `apply` same name, with a `with` list | | present | same id; order not moved; the listed properties replace their rules, the others are kept |
| present | `apply` same name, no `with` list / `define()` | | present | `styleRules` kept |
| any | `setValue`, `setClock` | | recomputed | creation order, each entry's own Env |
| any | `define(name, type, value, {inputs})` | an input name unknown | present | that input skipped |
| `applyAll` | line fails | | `failed` += `targetNamesOf(src)` | `P_{1}` stored as `P_1` |

- **Reachable invalid states or transitions:** the first absent-to-present row drops a `SELF_ID` read instead of mapping it to the new id, so a first definition's style that reads only its own object stores no rule and the dependents test misses it (`f(x) = x with opacity = f(1)` on an empty figure, then `f(x, y) = x + y` is accepted): LANG-SM-33 (open). Rerange lines are not stored, so a later cycle test on this figure misses their edges; that is a stated limit of the scratch figure (it is not the kernel), noted in `handoff/language/findings.md`, not a finding. The real kernel must drop a target's property rules when the target is deleted (this class has no delete). Closed: LANG-SM-32 (round 5: property rules per property), LANG-SM-27 (round 4: style reads out of `inputs`), LANG-SM-9 (stored `free` now true for a command in a range or style), LANG-SM-17, LANG-SM-20.

### L12. Preview

- **Where:** `tooling.ts` `preview`, `shiftBack`, `previewInner` (lines 70 to 140).
- **States:** `analyse` → (`unnamed_object` → `retry` under the name the line would get, from the error's `name` param, or `pvw<k>` only if none was offered) → `compiled` → `evaluated` in a fresh Env reading the figure → result; or error with `incomplete`. An error from `retry` goes through `shiftBack`.
- **Invariants:** nothing in the figure changes; error columns and lines refer to the text the user typed (prefix removed, trimmed leading whitespace and blank lines added back); a temporary `pvw` name never reaches the user unless no name was offered; a preview runs no unbounded work.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| analyse | `unnamed_object` | text not empty | retry | prefix `name = ` and analyse again |
| retry | error | | error | positions moved back; `source` set to the typed text |
| analyse | error | | error | `incomplete` from kind and key |
| ok | define, not state, not command | | evaluated | evaluation runs (builtins not folded) |

- **Reachable invalid states or transitions:** none open. Closed: LANG-SM-18, LANG-SM-2.

### L13. Cursor context, signature help, completion, highlighting

- **Where:** `tooling.ts` `cursorContext`, `typeArgs`, `signatureHelp`, `complete`, `tokenize`, `colourLine`, `localNameTokens` (lines 167 to 804); `source.ts` `lastLogicalStart`.
- **States:** cursor in `comment`, `string`, `string expression`, after `.`, after `@`, after `in`, in a style list, after `prop =`, start of line, inside a call (frame stack of open brackets with comma positions), elsewhere. Completion keeps a sorted top list of `limit + 12`. `tokenize` lexes each logical line on its own with its `firstLine`.
- **Invariants:** the logical line found for the cursor is the one the splitter (L2) makes; cost per keystroke is linear in the text before the cursor; `tokenize` colours any text it is given, line by line (a single logical line over 2,000 characters gives `limit` only); registry lookups use `own`.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| prefix | `lastLogicalStart` | | logical prefix | one forward pass, same scanner as L2 |
| prefix | lex | | frames | `(`/`[` push (callee if a name precedes), `)`/`]` pop, `,` records |
| frame | `typeArgs` | complete args | typed args | one fresh `Checker` per argument |
| `tokenize(source)` | split into logical lines | | per line | lex and colour; errors collected from every line |

- **Reachable invalid states or transitions:** none open. After a hex colour preceded by any blank in `BLANKS`, `lastLogicalStart` cuts where the splitter does and `tokenize` gives the tokens of the plain-space line. Closed: LANG-SM-24 (round 4), LANG-SM-5, LANG-SM-21.

### L14. Command and function tables

- **Where:** `table.ts` `createCommandTable`, `createFunctionTable`, `checkTable` (lines 130 to 267); `builtins.ts` `BUILTIN_FUNCTIONS`.
- **States:** immutable once created (maps by name and by lower-cased name, sorted names).
- **Invariants:** a table never changes under a compiled line; `checkTable` reports every pair of forms that accept the same arguments with neither more specific.
- **Transitions:** none after creation; a new table is a new value. A figure's `commands` and `functions` may be swapped by the host between checking and compiling, but compiled lines hold the spec and form objects they were checked against.
- **Reachable invalid states or transitions:** none found.

## plot

Checked at commit `8f3a4c8` (pass 1) on `feat/plot`. Paths are under `packages/plot/src/`. Line numbers refer to `8f3a4c8`. Findings are in `handoff/plot/findings.md`; all are `open` after pass 1.

### P1. Sample cache

- **Where:** `cache.ts` `createSampleCache`, `cacheKey`, `seedForRange`, `paramSeedForRange` (lines 11 to 106). Used by callers to build `seed` for `plotFunction` and `traceParamCurve`.
- **States:** per cache: two insertion-ordered maps (scalar, parametric), each `key -> { version, samples }`, at most `capacity` keys each (default 8). No notion of function identity or current version.

| State | Holds |
|---|---|
| `empty` | No entries |
| `holding` | 1 to `capacity` entries per map, any mix of versions |

- **Invariants:** a seed for `(function, version)` holds only that function's samples at that version, one value per x; a seed only saves evaluations, so a plot is the same with or without it; a version change discards the older samples (functions-calculus 9, "Cache and incremental update").
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | `put(key, version, xs, ys)` | | `holding` | copies the arrays; an existing key keeps its insertion position |
| `holding` | `put` | size > capacity | `holding` | drops the first-inserted key (`trim`) |
| any | `seedForRange(version, lo, hi)` | | same | merges samples in `[lo, hi]` from every entry whose version matches, regardless of key |
| any | `clear()` | | `empty` | |

- **Reachable invalid states or transitions:**
  - Entries of other functions or views with the same version number are merged into one seed, with duplicate x values; the most recently re-put key can be evicted first; nothing clears older versions. [PLOT-SM-10](../handoff/plot/findings.md), open.
  - Seed samples count against `maxSamples` in the tracers, so a large seed stops refinement before it starts. [PLOT-SM-6](../handoff/plot/findings.md), open.

### P2. Function plot run (setup, refine, classify, band; suspend and resume)

- **Where:** `function.ts` `plotFunction` (1427), `resumeFunctionPlot` (1499), `runLoop` (1019), `runCurve` (1032), `runSetup` (314), `runRefine` (362), `runClassify` (461), `runExact` (992), `toToken` (1313), `checkToken` (1353), `finishSuspended`/`finishComplete` (1393, 1397); budgets in `evalAt` (277) and `intervalAt` (291).
- **States:** `phase` in `setup | refine | classify | band`, plus `suspended` (budget for this call spent) and `done`. A suspended run is serialised as a `FunctionResume` token: samples, the three span lists, markers, ink, counters, flags, phase, pieces, breaks, coarse grid and configuration.

| State | Holds |
|---|---|
| `setup` | Coarse grid `coarseXs`, `coarseDone` evaluated so far; each new coarse point pushes one pending span |
| `refine` | `pending` spans being split by the screen tests |
| `classify` | `suspicious` spans getting verdicts; verdicts may push back to `pending` |
| `band` | Exact mode only: one pending span per device-pixel column, one enclosure each |
| `suspended` | Any of the above with the budget spent; output empty, `resume` present |
| `done` | Paths, markers, ink and stats; no `resume` |

- **Invariants:**
  1. `stats.complete` is false exactly when `resume` is present, and then output is empty.
  2. The finished plot is the same however the work was sliced (functions-calculus 9, "Budgets").
  3. A suspension leaves `pending`, `suspicious`, `accepted`, markers, ink and the flags as they were before the interrupted step; a classify verdict is atomic (rolled back and redone whole).
  4. Every call with a positive budget makes progress.
  5. All samples in a run belong to one `(function version, view, pixel size)`.
  6. `band` is entered only with an enclosure; `complete: true` means every phase drained.
  7. A resumed run has the same limits as a fresh one.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| (start) | `plotFunction` | inputs valid | `setup` | pieces, coarse grid; seed samples loaded into `samples` |
| `setup` | coarse grid evaluated | | `refine` | batch form first when it fits the budget |
| `refine` | `pending` empty | `suspicious` empty | `done` (or `band`) | |
| `refine` | `pending` empty | `suspicious` not empty | `classify` | |
| `refine` | `samples.size >= maxSamples` | | `classify` or `done` | pending spans accepted as they are, `capped` |
| `classify` | verdict pushes to `pending` | `suspicious` drained | `refine` | |
| `classify` | `suspicious` empty, `pending` empty | | `done` (or `band`) | |
| `refine`/`classify` | `steps > STEP_CAP` | | same | `forceCap`: accept pending, drop suspicious, `capped`, `rigorous = false` |
| curve done | | `exact` and enclosure | `band` | ink cleared, one span per column |
| any | `evalAt`/`intervalAt` over budget | | `suspended` | classify rolls back the current verdict |
| `suspended` | `resumeFunctionPlot(token, fn, opts)` | token passes `checkToken` | token's phase | fresh per-call budget, totals carried |
| `done` | | | | chain spans, resolve breaks, thin to `maxSamples`, domain end markers, sort |

- **Reachable invalid states or transitions:**
  - A budget stop inside `refineUndefined` is not propagated: the loop spins to `STEP_CAP`, `forceCap` discards pending and suspicious spans, and the token carries the damage (breaks 2, 3). [PLOT-SM-4](../handoff/plot/findings.md), open.
  - A token has no function version; resuming with another function stitches two functions into one plot (breaks 5). [PLOT-SM-5](../handoff/plot/findings.md), open.
  - Interval evaluations are not cached, so a verdict costing more than one call's budget is rolled back forever (breaks 4). [PLOT-SM-8](../handoff/plot/findings.md), open.
  - `band` resumed without the enclosure returns `complete: true` with a partial band and the curve (breaks 1, 6). [PLOT-SM-9](../handoff/plot/findings.md), open.
  - `checkToken` does not check `depth`, `bendPx`, `chordPx`, `maxSamples`, `coarseXs` or `pieces` (breaks 7). [PLOT-SM-15](../handoff/plot/findings.md), open.
  - Seeds count against the cap (see P1). [PLOT-SM-6](../handoff/plot/findings.md), open.
  - Forked tokens (one token resumed twice) and interleaved runs of different functions stay independent and equal to the direct plot: checked, nothing found.

### P3. Function span lifecycle and verdicts

- **Where:** `function.ts` `runRefine` (362), `refineUndefined` (430), `classifyDefined` (588), `classifyUndefined` (748), `classifyEdge` (780), `classifyEdgeEnclosed` (818), `finishEdge` (867), `probeHole` (945), `findPartner` (959), `markJump` (572), `inkForSpan` (721), `resolveBreaks` (1126).
- **States:** each x-span `[xl, xr]` at a depth is in exactly one list.

| State | Meaning |
|---|---|
| `pending` | To be tested by the screen tests |
| `accepted` | Drawn as a chord |
| `suspicious` | Needs a verdict |
| dropped | A gap (undefined), or replaced by its halves, an ink column or a feature split |

- **Invariants:** a span is in one list at a time; a marker is recorded only for a verdict (pole, hole, jump, open or closed end) that the enclosure or the heuristics support; oscillation becomes ink, not markers; the cost of one verdict is a bounded number of evaluations and lookups.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `pending` | both ends defined, midpoint defined | fails bend or chord test, depth < limit, wider than 0.5 px | two `pending` halves | |
| `pending` | same | fails, at the depth limit or narrower than 0.5 px | `suspicious` | |
| `pending` | same | passes | `accepted` | |
| `pending` | one end or midpoint undefined | depth < limit | `pending` halves touching a defined end | |
| `pending` | same | at the depth limit | `suspicious` | |
| `suspicious` | both defined, values leave the view on both sides | enclosure unbounded, or both sides tall | two `accepted` sides | `pole` marker |
| `suspicious` | both defined, change in one place | enclosure bounded and `def = 2` | `accepted` | steep rise |
| `suspicious` | same | step flat on both sides | two `accepted` sides | `jump`, `openEnd`/`closedEnd` |
| `suspicious` | same | not flat, or two or more sign flips | dropped | ink column |
| `suspicious` | neither end defined | enclosure `def = 1` or a defined midpoint, wider than 0.1 px | two `suspicious` halves | |
| `suspicious` | one end defined | edge bisected; tall | `pending` approach | `pole` |
| `suspicious` | same | matching value across | `accepted` across | `hole` |
| `suspicious` | same | partner across with a different value | `pending` approach | `jump` and ends, or ink |
| chains at a break | `resolveBreaks` | limits and value agree / limits agree / tall / otherwise | merged / merged / cut / cut | none / `hole` / `pole` / `jump` and ends |

- **Reachable invalid states or transitions:**
  - `findPartner` (and `edgeFallbackY`) scan every sample per verdict, so cost per verdict grows with the sample count. [PLOT-SM-3](../handoff/plot/findings.md), open.
  - `sin(1/x)` without an enclosure still records about 1,000 `hole`/`openEnd`/`jump` markers. [PLOT-SM-14](../handoff/plot/findings.md), open.

### P4. Parametric tracer

- **Where:** `param.ts` `traceParamCurve` (583), `cullBoxes` (160), `findHoles` (198), `runRefine` (257), `runClassify` (355), `classifyEdge` (435), `joinPartner` (479), `markJoins` (702), `finishParam` (760).
- **States:** `cull -> holes -> coarse -> refine <-> classify -> done`, or `dead` (budget spent: `complete: false`, empty output). No suspend and resume. Spans use the same `pending`/`accepted`/`suspicious` lists as P3.

| State | Holds |
|---|---|
| `cull` | Parameter boxes from the enclosure; off-view and `def = 0` boxes dropped; boxes over 128 px split to depth 10 |
| `holes` | `def = 1` bounded boxes bisected to depth 40; up to 8 hole probes per box |
| `coarse` | `max(64, widthPx / 6)` samples spread over kept boxes |
| `refine`/`classify` | As P3, with a turning-angle test, cusp and stall markers, pole and hole-like verdicts |
| `dead` | Budget spent in any state |
| `done` | Chains, joins marked, thinned, clipped, closed flags |

- **Invariants:** the hole search costs a bounded share of the budget; an enclosure never makes a trace less likely to finish; markers carry drawable pixel coordinates; output points at most `maxSamples`.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| (start) | valid input | enclosure | `cull` | else one box over the range |
| `cull` | boxes kept | enclosure | `holes` | |
| `holes`/`cull` | done | | `coarse` | |
| `coarse` | grid evaluated | | `refine` | |
| `refine` | pending empty | suspicious not empty | `classify` | |
| `classify` | pending refilled | | `refine` | |
| any | over budget | | `dead` | |
| `refine` | `samples.size >= maxSamples` | | `done` | pending accepted, `capped` |
| `refine`/`classify` | drained | | `done` | `end` markers unless the curve is closed |

- **Reachable invalid states or transitions:**
  - `findHoles` descends every `def = 1` box to depth 40, so a curve with many defined/undefined boundaries fails with a sound enclosure and succeeds without one. [PLOT-SM-11](../handoff/plot/findings.md), open.
  - `joinPartner` scans every sample per edge. [PLOT-SM-3](../handoff/plot/findings.md), open.
  - `addMarker` records any coordinates (pole markers at `py = ±7.1e19`). [PLOT-SM-16](../handoff/plot/findings.md), open.
  - Seeds count against the cap (see P1). [PLOT-SM-6](../handoff/plot/findings.md), open.

### P5. Implicit quadtree

- **Where:** `implicit.ts` `traceImplicit` (449), `runQuadtree` (385), `runDense` (370), `splitNode` (415), `boxAt` (110), `gEval` (84), `cornerAt` (100).
- **States:** per node of the leaf grid (padded view, 2 px leaves for `final`, 6 px for `draft`, roots of 32 px): `queued`, `dropped`, `split`, `leaf` (traced by P6). Per run: `running`, `dead` (budget spent: `complete: false`, empty), `done`. Without an enclosure the run is `dense`: every leaf is traced, `rigorous: false`.
- **Invariants:** a node is dropped only when its enclosure excludes the level or `def = 0`; every residual input is evaluated once (`memo`); memory per call is bounded by a figure-sized budget; the view limits count the device pixels actually sampled; the default budget completes an ordinary figure.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `queued` | `boxAt` | `def = 0`, or `lo > 0`, or `hi < 0` | `dropped` | |
| `queued` | `boxAt` | contains the level, wider than one leaf | `split` | 2 or 4 children queued |
| `queued` | `boxAt` | contains the level, one leaf | `leaf` | `emitLeaf` (P6) |
| `running` | over budget | | `dead` | |
| `dense` | every leaf visited | | `done` | |
| `running` | queue drained | | `done` | link, clip, thin, markers |

- **Reachable invalid states or transitions:**
  - `memo` and `corners` grow with string keys up to the evaluation cap; with `devicePixelRatio: 4` a view inside `checkView`'s limits held 1.9 GB; no leaf-cell limit as in `fillRegion`. [PLOT-SM-2](../handoff/plot/findings.md), open.
  - Without an enclosure, `sin(x) + sin(y) == sin(x*y)` on a 1,000 x 600 view returns `complete: false` at the default budget. [PLOT-SM-7](../handoff/plot/findings.md), open.

### P6. Implicit leaf classification and linking

- **Where:** `implicit.ts` `emitLeaf` (221), `correctCrossing` (130), `probeSmallFeature` (295), `uniqueMarkers` (506), `finishChains` (522); `squares.ts` `segmentsForCase` (37), `linkSegments` (202); `clip.ts` `clipPolyline`.
- **States:** per leaf, the marching-squares case (0 to 15). Per grid edge, one crossing (`crossings`, shared by both leaves). Per chain: `open` or `closed`; after clipping, a closed chain that was cut becomes open pieces; a closed chain under 0.25 px becomes an `isolated` marker.
- **Invariants:** neighbouring leaves use the same crossing on a shared edge; a Newton correction is kept only when it lowers `|F|`; chains are deterministic (sorted); work and output follow the curve length and the sample cap.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| leaf | corners | any NaN | skipped | |
| leaf | case 0 or 15 | enclosure | probed | 5 x 5 subgrid and Newton; `isolated` marker when found |
| leaf | case 0 or 15 | a corner exactly on the level, all 8 neighbours on one side | marked | `isolated` |
| leaf | case 5 or 10 | | segments | centre value decides the pairing |
| leaf | other cases | | segments | crossings interpolated and corrected; `singular` when the gradient vanishes |
| segments | `linkSegments` | shared keys | chains | `closed` when the ends share a key |
| chains | `finishChains` | | paths | clip to view, open chains from the smaller end, sort, thin |

- **Reachable invalid states or transitions:**
  - `uniqueMarkers` is quadratic and markers are uncapped: `x - x == 0` with an exact enclosure on a 400 px view gives 53,824 markers in 64 s. [PLOT-SM-1](../handoff/plot/findings.md), open.
  - `linkSegments` stayed linear for long chains: checked, nothing found.

### P7. Region filler

- **Where:** `region.ts` `fillRegion` (549), `runFill` (117), `runDense` (162), `fillCoarse` (212), `checkCap` (218), `boundaryLeaf` (228), `supersample` (312), `addMarker` (378), `mergeRects` (387), `traceBorder` (441), `segmentOnBoundary` (498).
- **States:** per node: `queued`, `false` (skipped), `true` (filled in the leaf bitmap), `split`, boundary `leaf` (polygon or supersampled). Per run: `running`, `capped` (remaining nodes filled coarsely), `dead`, `borders` (one implicit trace per primitive, sharing the budget), `done`. Without an enclosure the run is `dense`: every leaf corner tested once.
- **Invariants:** a `true` cell is wholly inside, a `false` cell wholly outside; emitted points are at most `maxSamples`; `capped` is set exactly when output was limited; a capped fill never claims area the predicate does not hold; work follows the boundary length; the default budget completes an ordinary figure.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `queued` | enclosure | `false` | skipped | |
| `queued` | enclosure | `true` | filled | bitmap cells set |
| `queued` | enclosure | `maybe`, wider than one leaf | `split` | |
| `queued` | enclosure | `maybe`, one leaf | boundary leaf | polygon if exactly one primitive crosses and the case is not a saddle; else 4 x 4 supersample |
| `running` | `points > maxSamples` | enclosure path only | `capped` | |
| `capped` | next node | not `false` | filled | whole node filled |
| `dense` | 4 true corners / 0 / mixed | | filled / skipped / boundary leaf | |
| supersample | 16 covered | not a corner leaf | filled | joins the bitmap |
| supersample | 1 or 2 covered | | rects | `isolated` marker |
| fill done | | margins given | `borders` | `traceImplicit` per margin, segments kept where a point just inside satisfies the body |
| `borders` | done | | `done` | merge rows into rectangles, polygons to pixels |
| any | over budget or a border trace incomplete | | `dead` | |

- **Reachable invalid states or transitions:**
  - `addMarker` scans every marker per insert; touching checkerboard cells produce 18,321 `isolated` markers and 5.4 s at 500 x 400 px. [PLOT-SM-1](../handoff/plot/findings.md), open.
  - `points` counts covered sub-cells, the dense path never checks the cap, and a tripped cap fills every non-`false` node (a checkerboard becomes one rectangle). [PLOT-SM-12](../handoff/plot/findings.md), open.
  - Without an enclosure, a half-plane on a 1,000 x 600 view returns `complete: false` at the default budget. [PLOT-SM-7](../handoff/plot/findings.md), open.
  - Borders with an enclosure cost about 4 times the fill (half-plane 5.7 ms against 0.3 ms). [PLOT-SM-13](../handoff/plot/findings.md), open.

### P8. One-variable predicate filler

- **Where:** `region.ts` `fillPredicate1D` (658 to 816).
- **States:** a stack of x-spans; each popped span becomes `true` (in `spans`), `false` (in `falses`) or splits; sub-half-pixel `maybe` spans are decided by one centre test. Then true spans merge, and each edge that abuts a false span is bisected to 0.1 px. Run: `running`, `dead`, `done`.
- **Invariants:** spans tile the view; every true edge inside the view abuts a false span; the budget bounds the work.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| span | three-valued state | `true` / `false` | `spans` / `falses` | |
| span | `maybe` | wider than 0.5 px and splittable | two spans | |
| span | `maybe` | narrower than 0.5 px | `spans` or `falses` | one centre test |
| merged span | edge | abutting false span | sharpened edge | bisection to 0.1 px |
| any | over budget | | `dead` | empty output |

- **Reachable invalid states or transitions:** none found. `falses.find` per merged span is linear per lookup; 200 to 625 bands stayed fast.
