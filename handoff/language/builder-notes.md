# Language area: builder notes

Branch `feat/language`. Everything is in `packages/kernel/src/language/` and exported from `packages/kernel/src/index.ts`.
`npm run lint`, `npm run typecheck` and `npm test` pass. No tests were written (the tester writes them).

## What was built

| File | Holds |
|---|---|
| `source.ts` | NFC and typographic normalisation with the offset map (`SourceMap`: normalised offset to line, UTF-16 column and the token as typed); logical-line splitting (a line continues while a `(` or `[` is open) |
| `lexer.ts` | Tokens, all lexical errors (`bad_character`, `bad_number`, `unterminated_string`, `bad_escape`, `bad_format`, `unbalanced`, `limit`), `precision_loss` notices, text parts with `{expr:fmt}` |
| `ast.ts`, `parser.ts`, `printer.ts` | Syntax tree, recursive-descent parser for every line kind (comment, directive, define, defmany, function, rate, restyle, rerange, action), operators and precedence, the one implicit multiplication, chained comparisons, `ambiguous_implicit`, `missing_operator`, `assign_in_expr`, colon labels, `unnamed_object`; canonical printing |
| `types.ts` | `Ty` (with `List<T>`, `Function<R>(n)`, `Relation`), type sets and aliases (`Shape`, `Path`, `Curvelike`, `Scalar`), the operator table (3.10) |
| `names.ts` | Name validity, reserved names, `suggestName` |
| `table.ts` | `CommandSpec`, `CommandForm`, `ParamSpec`, `FunctionSpec`, `FigureView`, `createCommandTable`, `checkTable` (the "no ambiguous overloads" test), `formText` |
| `builtins.ts` | About 75 built-in functions with numeric behaviour and undefined reasons, constants, `MathLib` / `setMathLib` |
| `check.ts`, `lines.ts`, `relation.ts`, `props.ts`, `tnode.ts` | Resolve and type-check: inference, field table, `if`, lists, ranges, relations (Line, Circle, Curve, Region by polynomial expansion), command and built-in matching (order-independent forms, named arguments, binders and bodies, closest-form diagnosis with `problems`, drop-one-argument suggestions), redefinition (type_change, cycle, breaks_dependents), states and rates, `with` properties, directives, limits, up to 8 errors per line |
| `compile.ts`, `runtime.ts` | Closure compiler (no `eval`, no `new Function`), `Env`, runtime value shapes, undefined reasons and `via`, constant folding, function values with `call`, `call1`, `batch` |
| `tooling.ts` | `preview`, `signatureHelp`, `complete`, `analyseLine`, `tokenize` (highlighting) |
| `figure.ts` | `ScratchFigure`: a small in-memory `FigureView` that can apply simple definition lines. It is **not** the kernel; it exists for previews, tools and tests |

Contracts: appended entries under `// language` to `AreaErrorKinds`, `AreaNoticeKinds` (`errors.ts`) and `AreaUndefReasons` (`values.ts`). The `eslint-disable` comments above those three empty interfaces were removed because they would now be unused directives. Existing shapes are untouched.

Measured (Node, warm): parse plus check of a typical line 0.008 ms; a 5,000-object figure completes in under 1 ms.

## Public API

All pure; nothing throws across the boundary (internal faults return an `internal` error).

```ts
// parse (steps 1 and 2)
parseLine(source: string, opts?: ParseOptions): Result<ParsedLine>
parseProgram(source: string, opts?: ParseOptions): { line: number; result: Result<ParsedLine> }[]
tokenize(source: string, fig?: FigureView): { tokens: HighlightToken[]; errors: LanguageError[] }
lex(sm: SourceMap): LexResult;  new SourceMap(raw: string, firstLine?: number)
printExpr(e: Expr): string;  printLineNode(n: LineNode): string

// check (steps 3 and 4)
checkLine(parsed: ParsedLine, fig: FigureView, opts?: CheckOptions): Result<CheckedLine>
analyseLine(source: string, fig: FigureView, opts?: { line?: number }): Result<CheckedLine>   // parse + check

// compile (step 5)
compileLine(line: CheckedLine, opts?: CompileOptions): Result<CompiledLine>
compileNode(n: TNode, opts?: CompileOptions): Compiled<unknown>
evaluate(c: Compiled<unknown>, env: Env): { defined: true; value } | { defined: false; reason; detail?; via? }
createEnv(init?: EnvInit): Env

// editing aids
preview(source: string, fig: FigureView): PreviewResult
signatureHelp(source: string, cursor: number, fig: FigureView): SignatureHelp | null
complete(source: string, cursor: number, fig: FigureView, opts?: { limit?: number }): Completion[]
suggestName(type: Ty | TypeName | string, taken: Set<string> | ((n: string) => boolean), opts?: { unit?: 'angle'; commands?; functions? }): string

// tables
createCommandTable(specs: CommandSpec[]): CommandTable;  createFunctionTable(specs): FunctionTable
checkTable(table | specs): TableProblem[]
BUILTIN_FUNCTIONS, BUILTIN_CONSTANTS, setMathLib(lib: MathLib)
ScratchFigure   // new ScratchFigure({ commands }); .define(), .apply(line), .applyAll(lines), .env(), .recompute()
```

`FigureView` is what the kernel implements: `lookup(name)`, `byId(id)`, `names()`, `inputsOf(id)`, `dependentsOf(id)` (with each dependent's definition source), `commands`, optional `functions`, `directives`, `size`, `read(id)`, `clock()`.

A `CheckedLine` carries: `kind`, `op` (`add` | `redefine` | `restyle` | `rerange` | `rate` | `action` | `directive` | `noop`), `names`, `type` / `types`, `unit`, `free`, `isState`, `existing` (id), the typed tree `expr` (`TNode`), `params` (function slots), `range`, `style`, `state`, `rate`, `directive`, `reads` (object ids), `usesT`, `slots`, `text` (canonical definition), `shape` for relations.

Errors are the unified `ErrorObject` plus optional `fix`, `quickFixes`, `more`, `problems`, `left`, `right`, `limit`, `after` (type `LanguageError`). Notices come in `Result.notices` (`shadowed`, `index_literal`, `precision_loss`, `clamped`, `unused_binder`).

Table extensions I needed (all optional, additive to core section 5):
- `CommandForm.rest` / `FunctionForm.rest`: variadic tail (`Hide(obj, …)`, `max(a, b, …)`).
- `ParamSpec.scope`: names that exist only inside a body argument (`i u v age` for `Particles`).
- `CommandForm.returns`: a type, a tuple for `defmany`, `null` for actions, `=param` for "same type as that argument" (transforms) and `List<=param>`.
- Parameter types are text: `Number`, `List<Point>`, `Function<Number>`, `Shape`, `Number|Point`, `Relation`, `Any`.

## Left out, and why

- **Rule factories and command evaluation.** The language matches and types a command call and hands the kernel the chosen form with typed arguments (`CheckedLine.expr` is a `command` node; `compileLine(...).command` has compiled arguments). Running a form is the kernel's job; inside an expression it calls `CompileOptions.runCommand`, and without it the value is undefined with reason `not_set`.
- **Error-recovering parser for completion.** Signature help and completion use a tolerant scan of the tokens left of the cursor (bracket stack, commas, last token) and the normal parser for the arguments already typed, not a second error-recovering grammar. Same lexer and parser, no hole nodes.
- **Exact derivative for `f'(x)`.** It is a numeric central difference (orders 1 to 3). Exact differentiation belongs to the `Derivative` command in `functions-calculus`.
- **`h = f(g(x))` as a Function** (last row-ish of 3.8). Without parameters `x` is free, so it is `free_variable` with a fix `h(x) = f(g(x))`. Function arithmetic (`f + g`, `2f + 1`) and a bare alias (`h = f`) work.
- **Circle from a non-constant equation.** `x^2 + y^2 == r^2` with a slider `r` is a `Curve` (conic) because the radius is not known at check time; with constants it is a `Circle`.
- **Dependents test beyond direct readers.** `breaks_dependents` re-checks the direct dependents of the redefined object against the new type. Deeper ones cannot break without the direct reader changing type, which is itself reported.
- **Directive argument validation** is done for `view`, `grid`, `axes`, `snap`, `beat`, `clock`; every other known directive name is accepted with any words (their areas validate). Unknown names are `unknown_directive`. `DIRECTIVES` is an appendable table.
- **Property table.** `props.ts` carries the kernel's property list (kernel design 9.1) so `with` can be checked at language level. Values of enum properties are checked; per-object-type validity is not.
- **Localisation.** Messages are built from `messageKey` + params with English templates in `errors.ts`; no other locale.
- **`MathLib` is an interface only**; the platform maths is used. No bit-exact port.
- **`$…$` maths in Text** is kept as plain text.
- **Kernel services** (`Rename`, `Delete`, `applyBatch`, undo, ordering moves, counting objects) are not here. `FigureView.size` lets the object limit (5,000) work when the kernel supplies it.

## Where the docs were unclear, and what I chose

1. **Continuation lines.** `design.md` 3.3 and 3.19 say a newline never continues a line; README decision 17 says a call may continue while a bracket is open. I followed the README. `parseProgram` splits logical lines; `parseLine` accepts exactly one logical line and rejects a second.
2. **Error field names.** `language/errors.md` uses `fix` and `quickFixes`; `errors/design.md` uses `suggest` and `recovery`. I emit both: `suggest` (max 3 lines) always, `fix` when there is exactly one safe candidate, `quickFixes` for multi-line repairs. Kind names follow the unified list: `bad_character` (not `bad_char`), `arg_count` (not `bad_arity`), `limit` for line length, tokens and depth (not `too_long` / `too_deep`), `syntax` for a colon label.
3. **New kinds and codes.** Kinds the unified list lacks, added under `// language`: `bad_escape`, `bad_format`, `missing_operator`, `ambiguous_implicit`, `chained_comparison`, `assign_in_expr`, `unknown_function`, `free_variable`, `breaks_dependents`, `empty_list_type`, `duplicate_arg`, `not_a_binder`. I gave them codes `L008` to `L019` (the catalogue stops at `L007`); the errors area should confirm or renumber. Notice codes `L201` to `L205`.
4. **`1e` and `2e`.** `errors.md` lists `1e` as `bad_number`; `design.md` 3.3 says the exponent is taken only when digits follow, so `2e` is `2 * e`. I followed 3.3.
5. **Name followed by a space and `(`.** `agent.md` 5.1 writes `f(x) = m (x - A.x) + A.y`, but core section 3 and `design.md` 3.6 allow implicit multiplication only after a number literal. I followed the strict rule: `m (x - A.x)` is `not_callable` with the fix `m * (…)`. Either the lesson or the rule should change.
6. **Closest form.** "Fewest problems" would pick a form with the wrong argument count over a form with the right count and two wrong types (the `Circle(A, 2, 3)` example in `errors.md` expects the 3-argument form). I prefer forms whose argument count fits, then fewest problems.
7. **Undefined and comparisons.** `errors.md` says comparisons with NaN are false; `design.md` 3.5 says anything involving undefined is undefined except `and`/`or` shortcuts. I followed 3.5: comparisons with an undefined operand are undefined, and an `if` with an undefined condition is undefined (reason `input_undefined`). With no true arm and no otherwise: `condition_false`.
8. **Undefined reasons.** Added `explicit`, `not_integer`, `no_value_yet` to the registry. `fact(2.5)` and `gcd` / `lcm` / `ncr` / `npr` on non-integers give `not_integer` (errors.md) rather than `out_of_domain` (design.md table). Negative arguments give `out_of_domain`.
9. **`index_literal`.** Only `0` and non-integers warn; negative integers count from the end (README decision 1).
10. **`if`.** README decision 13 (any number of arms, even count means no otherwise) replaces the 2/3-argument grammar.
11. **Tuples.** `(a, b, c)` parses; the checker rejects it with `syntax` (a point has two coordinates) so the 3D area can accept it later.
12. **Two-variable functions** are `Function` with `arity` 2 to 4 (design 3.10); I did not add a separate `Function2` type name.
13. **`z`** is reserved as a name but not allowed as a function parameter (only `x`, `y`, `t` may be reused), per 3.7.
14. **Hex colours** (`color = #ff0000`): the lexer treats `#` right after `=` and followed by 3, 4, 6 or 8 hex digits as a colour word, not a comment.
15. **Bool values** at run time are `true`, `false` or `undefined`; Number undefined is `NaN` plus `env.reason`, as in 3.15.
16. **Angle tag.** `°`, `deg`, `todeg`-style results follow the "preserved obviously" rules; `asin`, `acos`, `atan`, `atan2`, `acot`, `torad` return angle-tagged Numbers.
17. **Unnamed lines.** `parseLine` already raises `unnamed_object` for non-call expressions and lower-case calls; for PascalCase calls it returns an `action` line and `checkLine` raises `unnamed_object` when the command is an object command. Pass `isObjectCommand` to `parseLine` to get it at parse time.
