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

Checked at commit `d2d9d9e` on `feat/language`. Paths are under `packages/kernel/src/language/`. Findings are in `handoff/language/findings.md`.

### L1. Normaliser modes

- **Where:** `source.ts` `normalise` (lines 34 to 189).
- **States:**

| State | Holds |
|---|---|
| `code` | Typographic rewrites apply (`−`, `×`, `π`, superscripts, smart quotes open a string) |
| `string` (braceDepth 0) | Characters copied; `\x` copied as a pair; `{` enters interpolation |
| `string` (braceDepth > 0) | Code rules apply inside `{…}`; nested `{`/`}` counted |
| `comment` | Characters copied to end of line |

- **Invariants:** `start[i]`/`end[i]` map every normalised index to the raw text; a newline always returns to `code`; the lexer sees the same string boundaries as this machine.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | `\n` or `\r` | | `code` | braceDepth = 0; `\r\n` becomes one `\n` |
| `code` | `#` | | `comment` | |
| `code` | `"` `“` `”` `„` | | `string` | pushes `"` |
| `string`/0 | `"` `“` `”` `„` | | `code` | pushes `"` |
| `string`/0 | `{` | | `string`/1 | |
| `string`/>0 | `{` / `}` | | depth ±1 | |
| `string`/>0 | `"` `“` `”` (not `„`) | | `code` | depth = 0 |
| `code` or `string`/>0 | superscript run, REPLACE char | | same | rewrite with offset map |

- **Reachable invalid states or transitions:** the splitter (L2) does not share these boundaries: LANG-SM-8 (open).

### L2. Logical-line splitter (continuation lines)

- **Where:** `source.ts` `splitLogicalLines` and `bracketDepth` (lines 275 to 318); used by `parser.ts` `parseLine` and `parseProgram`. A second, separate copy of the rule is `tooling.ts` `logicalStart` (lines 196 to 235).
- **States:** per physical line: `open` (bracket depth > 0 at its end, next line joins) or `closed`. Inside `bracketDepth`: `depth`, `inString`, `inComment`.
- **Invariants:** a line continues only while a round or square bracket is open (README decision 17); strings and comments are skipped exactly as the lexer skips them; a string never spans a newline (the lexer ends it there); splitting is linear in the program length; every limit (2,000 characters per logical line) is checked before work that grows with the joined text.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start of line i | scan line | depth = 0 | `closed` | emit logical line |
| start of line i | scan line | depth > 0 and a next line exists | `open` | append `\n` + next line, rescan the whole joined text |
| `open` | end of program | | `closed` | emit; the lexer reports `unbalanced` |
| scan | `\n` | | | `inComment` = false (`inString` is kept) |
| scan | `"` `“` `”` `„` | not in string | `inString` | |
| scan | `"` `“` `”` | in string | not in string | (`„` does not close here, although L1 closes on it) |

- **Reachable invalid states or transitions:** a string left open on one line keeps `inString` across the newline, so later lines are swallowed: LANG-SM-8 (open). The whole joined text is rescanned per added line: LANG-SM-5 (open). `logicalStart` rescans all earlier lines for each candidate start: LANG-SM-5 (open).

### L3. Lexer

- **Where:** `lexer.ts` `lex`, `lexRange`, `lexString`, `lexNumber`, `lexName` (lines 76 to 522).
- **States:** `main` loop of `lexRange(from, to, top)` with a bracket `stack`; `string` scan (`lexString`) with an interpolation sub-scan (`depth`, `inner`, `colonAt`) that recurses into `lexRange(top = false)` with a fresh stack; `number` scan (`digits`, fraction, exponent, `bad`); `name` scan (with `_{…}` subscript); terminal `limit` (line too long: no tokens).
- **Invariants:** every error carries columns of the raw text; the token count (800) and nesting depth (64) cover the whole line, including text interpolations; one bad character gives one error; tokens never overlap.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start | raw length > 2,000 | | `limit` | only an `eof` token |
| main | `(` `[` | stack < 64 | main | push |
| main | `(` `[` | stack = 64 | stop | `limit` error, rest of line unlexed |
| main | `)` `]` | stack empty / wrong opener | main | `unbalanced` error (pop on mismatch) |
| main | `"` | | string | |
| string | `{` | matching `}` before `"` or `\n` | `lexRange(top=false)` | fresh stack, tokens kept in the part only |
| string | `\n` or end | | main | `unterminated_string` |
| main | `#` | previous token is `=` and a hex colour follows | main | a `name` token `#rrggbb` |
| main | other character | | main | `bad` token + `bad_character` |
| end | | top and stack not empty | done | `unbalanced` with a suggestion that appends closers |
| end | | tokens > 800 and no earlier error | done | `limit` |

- **Reachable invalid states or transitions:** interpolation tokens and depth escape both limits: LANG-SM-7 (open). An astral character gives two errors: LANG-SM-19 (open). The "append closers" suggestion lands inside a trailing comment: LANG-SM-6 (open).

### L4. Parser and line-kind dispatch

- **Where:** `parser.ts` `Parser` (lines 34 to 1050), `parseLine`, `parseLineInner`, `parseLogical`, `parseProgram` (lines 1066 to 1138).
- **States:** `Parser` fields `pos`, `depth`, `callStack` (innermost call or bracket), `lineHead` (`bare`, `define`, `other`), `relationLike`; exit by return or by a `Stop` exception carrying the first error. A sub-parser is created for each text interpolation. `parseLogical` may re-enter itself once per unbalanced suggestion.
- **Invariants:** depth (calls, unary signs, `not`, power chains) never exceeds 64 counted together with the interpolation it sits in; one error per line from steps 1 and 2; error columns point at the token that caused them; the line number of an error is the physical line it is on; `1/2x`-style division by an implicit product is never read silently.
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
| start | anything else | | bare expression | upper-case call → action; else `unnamed_object` |
| expr | `enter()` | depth > 64 | Stop | `limit` |
| term | `/` then implicit product | right operand is `bin` with `implicit` | Stop | `ambiguous_implicit` |
| `parseLogical` | lexer error is `unbalanced` with a suggestion | | `parseLogical(suggestion)` | recursive; suggestion dropped if it fails |
| `parseLine` | more than one non-empty logical line | | error | `syntax` "a second line" |

- **Reachable invalid states or transitions:** `1/-2x` is read silently: LANG-SM-14 (open). Wrong line and column for leading blank lines, the "second line" error and errors inside `{…}`: LANG-SM-18 (open). Recursive re-parse: LANG-SM-6 (open). Sub-parser depth starts at 0: LANG-SM-7 (open).

### L5. Checker contexts and scopes

- **Where:** `check.ts` `Checker` (lines 166 to 1559), `lines.ts` `checkLine` and the per-kind checks.
- **States:** one `Checker` per line with `errors` (cap 8), `notices`, `reads`, `usesT`, `hasCommand`, `scopes` (a stack of frames), `slotCount`, `nodes` (cap 2,000), `ctx` (owner name and right-hand side span), `simpleUnknown`. Frames are pushed for function parameters (`checkFunction`), relation `x`/`y` (`buildRelation`), binders and body-scope names (`matchForms` pass 2). Exit by result, by collected errors, or by `Bail` (node limit).
- **Invariants:** a frame pushed is popped on every path; a local name resolves before constants, objects and commands; `reads` lists the inputs of the object's value rule; `free` is true only when the value holds its own value (no reads of the value expression); every type in a typed node is a real `Ty` from the language's type list; slot numbers are unique within the line.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| idle | `infer(node)` | nodes ≤ 2,000 | typing | `nodes++` |
| typing | `nodes` = 2,001 | | `Bail` | one `limit` error |
| typing | name | local frame has it | `local` node | |
| typing | name | object exists | `ref` node | `reads.add` |
| typing | field `.f` | `FIELDS[type][f]` truthy | `field` node | type taken from that entry |
| typing | function line | | push frame | params bound to slots 0, 1, … |
| typing | relation in `x`/`y` | | push frame | `x`, `y` bound to new slots |
| typing | style item / range bound | | typed | reads added to the same `reads` set |
| done | errors > 0 | | error | first error, up to 7 in `more` |
| done | non-`Bail` exception | | `internal` | |

- **Reachable invalid states or transitions:** prototype members accepted as fields, properties and directives: LANG-SM-1 (open). Style and range reads make free objects dependent: LANG-SM-9 (open).

### L6. Command and function form matcher

- **Where:** `check.ts` `matchForms`, `diagnose`, `dropSuggestions` (lines 1070 to 1504).
- **States:** `bindings` (one per form: bound, missing, extra, duplicate named); `candidates` (arity fits); `speculative` (more than one candidate); `typed` cache of value arguments by argument index (errors and notices stashed); per form `Test` (problems, invalid, score, binder problems); outcome `chosen`, `tie` (internal), `argument errors`, `binder errors` or `diagnosis`.
- **Invariants:** a value argument is typed with the expected type of the form it is tested against; errors inside an argument are reported in preference to a form diagnosis; a speculative failure in one form never hides a real error that every form shares; exactly one passing form or the most specific one wins.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start | named arg repeated / unknown name | | error | `duplicate_arg` / `bad_argument` |
| start | no candidate and a duplicate named arg | | error | `duplicate_arg` |
| candidates | test each form | | tested | value args typed once and cached with the first form's hint; bodies typed per form in a binder frame |
| tested | ≥ 1 passing | one lowest score | chosen | flush cached errors and notices |
| tested | ≥ 1 passing | equal lowest scores | `internal` | |
| tested | none passing, some invalid | errors flushed > 0 | argument errors | |
| tested | binder problems | | `not_a_binder` | |
| tested | otherwise | | diagnosis | `arg_count` or `no_matching_form` with the closest form |

- **Reachable invalid states or transitions:** the cache reuses another form's hint: LANG-SM-15 (open). Body errors are dropped when several forms compete: LANG-SM-16 (open).

### L7. Redefinition, cycle and dependents check

- **Where:** `lines.ts` `checkRedefinition`, `findPath`, `parseOne` (lines 119 to 218); `check.ts` `OverlayFigure` (lines 120 to 162).
- **States:** `new` (object limit test), `redefine` → `type test` → `cycle test` (depth-first search over `inputsOf`) → `dependents test` (each direct dependent re-parsed and re-checked against an overlay with the new type) → `ok` or an error.
- **Invariants:** a redefinition that creates a cycle is refused with its path; one that keeps the graph acyclic is never refused; the test runs in bounded stack for every figure the object limit allows (5,000).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start | no existing object | size ≥ 5,000 | error | `limit` |
| start | existing | kind differs | error | `type_change` |
| type ok | DFS from new reads | reaches the target | error | `cycle` with path |
| type ok | DFS | finishes | dependents | |
| dependents | re-check each | fails or changes type | error | `breaks_dependents` |

- **Reachable invalid states or transitions:** recursive DFS overflows the stack on a long chain: LANG-SM-4 (open).

### L8. Compiler and constant folding

- **Where:** `compile.ts` `Compiler` (lines 177 to 833), `compileNode`, `compileLine` (lines 875 to 990).
- **States:** one `Compiler` per line with `usesInf` (set when an `inf` constant is compiled); each node compiled raw or folded (evaluated once in a scratch `Env` and replaced by its value).
- **Invariants:** folding gives the same value evaluation would give later; whether an infinity may be stored depends only on whether that value came from `inf` (ruling Q4); folding never runs unbounded work.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| node | compile | constant subtree, not literal or text | folded | runs builtins now with the current MathLib |
| node | compile | `inf` constant | raw | `usesInf = true` for every later node of the line |
| line | compile style items first, then value, state, range | | compiled | style `inf` sets `usesInf` for the value |

- **Reachable invalid states or transitions:** LANG-SM-11 (sticky `usesInf`), LANG-SM-13 (folded values keep the old MathLib), LANG-SM-2 (folding runs `ncr`/`npr` loops) (all open).

### L9. Env and evaluation

- **Where:** `runtime.ts` `Env`, `createEnv`, `resetEnv`, `fail` (lines 60 to 115); `compile.ts` `evaluate` (lines 1004 to 1024), function values (lines 918 to 958), relation values (lines 757 to 774), `pointwise` (lines 847 to 870).
- **States:** `Env` fields `reason`, `via`, `detail` (first reason wins), `inf` (an infinite input was read), `locals` (slot array), `t`/`bt`/`beat`, `read`. A `FunctionValue` or `RelationValue` captures the `Env` it was made in and writes its parameter slots into that `env.locals` on every call.
- **Invariants:** an evaluation starts with `reason`, `via`, `detail`, `inf` cleared; a call into a function value does not change the caller's locals, reason or via; a value is undefined exactly when its reason is set; `inf` provenance follows the value, not the evaluation.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | `evaluate` | | clear | reset four fields |
| evaluating | domain problem | `reason` unset | reason set | `fail` |
| evaluating | read of an infinite input | | `inf = true` | later overflows are kept as infinity |
| evaluating | `fv.call(xs)` | | callee running | writes `env_f.locals[slot]`; saves and restores `reason`, `via` (`call1`/`batch` restore `reason` only) |
| evaluating | `rel.residual(x, y)` | | | writes `env.locals[sx]`, `env.locals[sy]` |
| evaluating | exception | | undefined `not_finite` | |

- **Reachable invalid states or transitions:** callers and callees share slot numbers in one Env: LANG-SM-10 (open). `inf` flag sticks for the evaluation: LANG-SM-11 (open). Undefined text becomes the word `undefined`: LANG-SM-12 (open). Unbounded text growth: LANG-SM-3 (open).

### L10. Module-level mutable state

- **Where:** `builtins.ts` `M` with `setMathLib`/`getMathLib` (lines 40 to 49), `dv` (line 221); `types.ts` `setCache` (line 99); `tooling.ts` `lowerCache` (line 398, cleared at 50,000); registries `check.ts` `FIELDS`, `props.ts` `PROPERTIES` and `DIRECTIVES` (plain objects other areas append to).
- **States:** MathLib `platform` or `replaced`; caches empty or filled.
- **Invariants:** every evaluation of every figure uses one MathLib; results computed under one MathLib never mix with another; registries answer only their own keys.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| platform | `setMathLib(lib)` | | replaced | all figures, all later evaluations; already-folded constants unchanged |
| registry | lookup `R[key]` | key is an `Object.prototype` member | hit | returns a prototype function |

- **Reachable invalid states or transitions:** LANG-SM-1, LANG-SM-13 (open).

### L11. ScratchFigure

- **Where:** `figure.ts` `ScratchFigure` (lines 51 to 213), `targetNamesOf` (lines 219 to 223).
- **States:** entries by name and id, `order`, `nextId`, `clockState`; each entry has `value`, `inputs`, optional `compiled` and its own `env`. `applyAll` keeps a `failed` map of names a failed line would have made.
- **Invariants:** public methods never throw; a name made by a failed line marks later readers with `blockedBy`.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| absent | `apply` define/function | checks pass | present | evaluated with a new Env kept on the entry |
| present | `apply` same name | | present | same id; order not moved |
| any | `setValue`, `setClock` | | recomputed | creation order, each entry's own Env |
| any | `define(name, type, value, {inputs})` | input name unknown | throws | |
| `applyAll` | line fails | | `failed` += `targetNamesOf(src)` | |

- **Reachable invalid states or transitions:** LANG-SM-17 (throws), LANG-SM-20 (braced subscripts not recorded) (open).

### L12. Preview

- **Where:** `tooling.ts` `preview`, `previewInner` (lines 70 to 115).
- **States:** `analyse` → (`unnamed_object` → `retry` with `pvw<k> = …`) → `compiled` → `evaluated` in a fresh Env reading the figure → result; or error with `incomplete`.
- **Invariants:** nothing in the figure changes; error columns refer to the text the user typed; temporary names never reach the user; a preview finishes within its 1 ms budget class (no unbounded work).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| analyse | `unnamed_object` | text not empty | retry | prefix `pvwN = ` and analyse again |
| retry/analyse | error | | error | `incomplete` from kind and key |
| ok | define, not state, not command | | evaluated | constant folding and evaluation run |

- **Reachable invalid states or transitions:** LANG-SM-18 (shifted columns, `pvw1` in hints), LANG-SM-2 (hang) (open).

### L13. Cursor context, signature help, completion, highlighting

- **Where:** `tooling.ts` `cursorContext`, `logicalStart`, `typeArgs`, `signatureHelp`, `complete`, `tokenize`, `localNameTokens` (lines 138 to 801).
- **States:** cursor in `comment`, `string`, `string expression`, after `.`, after `@`, after `in`, in a style list, after `prop =`, start of line, inside a call (frame stack of open brackets with comma positions), elsewhere. Completion keeps a sorted top list of `limit + 12`.
- **Invariants:** the logical line found for the cursor is the one the splitter (L2) would make; cost per keystroke is bounded independent of the program length before the current logical line; `tokenize` colours any text it is given.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| prefix | `logicalStart` | | logical prefix | backward scan over earlier lines |
| prefix | lex | | frames | `(`/`[` push (callee if a name precedes), `)`/`]` pop, `,` records |
| frame | `typeArgs` | complete args | typed args | one fresh `Checker` per argument |
| `tokenize(source)` | lex whole source | length > 2,000 | no tokens | |

- **Reachable invalid states or transitions:** LANG-SM-5 (quadratic `logicalStart`), LANG-SM-21 (`tokenize` over 2,000 characters) (open).

### L14. Command and function tables

- **Where:** `table.ts` `createCommandTable`, `createFunctionTable`, `checkTable` (lines 130 to 267); `builtins.ts` `BUILTIN_FUNCTIONS`.
- **States:** immutable once created (maps by name and by lower-cased name, sorted names).
- **Invariants:** a table never changes under a compiled line; `checkTable` reports every pair of forms that accept the same arguments with neither more specific.
- **Transitions:** none after creation; a new table is a new value. A figure's `commands` and `functions` may be swapped by the host between checking and compiling, but compiled lines hold the spec and form objects they were checked against.
- **Reachable invalid states or transitions:** none found.
