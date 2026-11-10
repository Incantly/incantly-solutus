# Input language: design

Status: draft for review. Extends section 3 (line grammar), section 4 (types) and section 5 (commands as data) of `docs/design/formula-language-and-kernel.md` ("the core design"). Everything here is our own design; GeoGebra was studied for ideas only.

## 1. What the language does

A line of text becomes, or changes, one object in the figure. The same grammar serves three writers: the live teacher (streamed, one to five lines per `draw` call), a learner typing in the input bar, and a saved script being loaded. The input bar adds conveniences on top (auto-naming, quick fixes), but the kernel itself only accepts the strict form.

### 1.1 Sub-features

| # | Feature | Summary |
|---|---|---|
| 1 | Lexing | Unicode-tolerant tokens with a normalisation map so error columns point at what the user typed |
| 2 | Line kinds | comment, directive, define, define-function, define-many, rate, restyle, rerange, action |
| 3 | Expressions | Numbers, booleans, text with live parts, points (Cartesian and polar), lists and ranges, calls, indexing, fields, conditionals |
| 4 | Operators | Arithmetic, power, factorial, degree, comparison (chained), logic |
| 5 | Implicit multiplication | One narrow rule, with a named error for the ambiguous cases |
| 6 | Equations and inequalities | `y == 2x + 1`, `x^2 + y^2 == 4`, `y < x` become lines, circles, curves and regions |
| 7 | Names | Validity, subscripts, Greek, reserved words, scope, shadowing, suggested names |
| 8 | Redefinition and rename | Same `id`, dependents re-checked, a precise error if something breaks |
| 9 | Types and inference | Bottom-up inference, operator table, function arithmetic, list element types |
| 10 | Command argument matching | Order-independent forms, closest-form diagnosis, named arguments, binders and bodies |
| 11 | Built-in functions and constants | About 75 pure functions, with the reason a result is undefined |
| 12 | Syntax help | Signature help while the cursor is inside a call |
| 13 | Autocomplete | Context-aware, type-ranked, typo-tolerant completions from the same parser |
| 14 | Previews | A dry run of the line as the user types, with no commit |

### 1.2 What a teacher writes

```text
A = (1, 2)
B = (4, 6)
s = Segment(A, B)
m = (B.y - A.y) / (B.x - A.x)
f(x) = m * (x - A.x) + A.y
a = 3 in 0..10 step 0.5
c: x^2 + y^2 = 4
```

Only the last line is wrong. It fails with `syntax` at the colon (there is no colon form), and the earlier lines stay.

## 2. How GeoGebra does it

Summarised in plain words from the grammar, the lexer rules, the expression evaluator, the command dispatcher and the manual.

- **One grammar, many readings.** A single hand-written grammar (a parser generator input of about 1,900 lines) accepts a line and builds an expression tree. About 120 operations exist, from arithmetic to set difference, sequences, and element-of. The same grammar also parses CAS input and an external CAS dialect, with flags changing the meaning of some rules.
- **Labels are decided by lookahead.** The grammar tries, in order: a function definition, a spreadsheet range, a labelled line with a colon or `:=`, a bare expression or equation, and a few vector special cases. The first alternative that parses wins; each uses unlimited lookahead, which makes error positions unreliable.
- **Names and tokens.** `x`, `y`, `z` are tokens of their own, as are `pi`, `deg`, `inf`, `true`, `false`, and names ending in `(` or `[` (function labels). A name shaped like letters followed by digits (`B12`) is a spreadsheet cell, not an ordinary label. Letters from almost every script are allowed in names, plus subscripts and trailing primes. Both `(` and `[` call a command, and `;` or a polar separator marks polar points.
- **Equation or assignment.** `a = 3` can be either a new assignment or an equation `a - 3 = 0`. After parsing, a step decides which, using whether the left side is a plain label. Inputs such as `A: (3,2)` and `g: 3x + y = 7` give a name to a point or to a conic.
- **Implicit multiplication is everywhere.** Any two adjacent terms multiply, so `ab` may be `a*b`, `a b` and `a(b)` too. A special case treats `sin x` as a function call if `sin` is not a variable, and `sin^2 x` as a squared call. If a name followed by `(` is not a function, it becomes a product. If a name is unknown, the processor offers to split it into products or to create sliders for the unknown parts.
- **Evaluation.** The tree is resolved: names become object references, then each operation checks the types of both sides at run time and picks the arithmetic (number, vector, point, list, function, text). The result type decides which object is created.
- **Commands.** The tree for `Name(args)` goes to a table of command processors keyed by name. Each processor checks argument count and types by hand and picks an algorithm. Wrong arguments raise generic "illegal argument" or "illegal number of arguments" errors, followed by the command's accepted forms.
- **Redefinition.** An existing name on the left replaces the object; if type and dependencies allow, the object keeps its identity. Internally a failed redefinition rebuilds the construction from XML, which is slow.
- **Previews.** While typing, a timer (200 ms) runs the input in a sandbox so the user sees a ghost of the result.
- **Autocomplete.** A dictionary of command names (localised) is matched against the current word; selecting an entry inserts its syntax with placeholders. Syntax strings come from language files.

What works: one grammar for everything, live preview, forgiving input for beginners, a complete localised command dictionary.

What is weak: a parse failure collapses into a single message; the grammar's alternatives overlap, so some inputs parse in surprising ways; implicit multiplication makes every unknown name a product candidate; `=` is overloaded; names that look like spreadsheet cells are special; one grammar flag changes the rules for CAS; type checks happen at run time inside the expression evaluator; the command table mixes argument checking with algorithm creation, so docs, errors and autocomplete each need a separate copy of the syntax.

## 3. Our design

### 3.1 Pipeline

Every entry point (draw tool, input bar, script load, preview) runs the same five steps. The core design names them; here is what each does for the language.

| Step | Input | Output | Failure kinds |
|---|---|---|---|
| 1 Lex | text | tokens with source spans | `bad_character`, `bad_number`, `unterminated_string`, `bad_escape`, `limit` (line length, token count) |
| 2 Parse | tokens | `Line` tree | `syntax`, `unbalanced`, `unnamed_object`, `missing_operator`, `ambiguous_implicit`, `chained_comparison`, `assign_in_expr`, `limit` (nesting depth) |
| 3 Resolve | tree, figure | tree with references, local scopes | `unknown_name`, `unknown_command`, `unknown_function`, `not_callable`, `free_variable`, `reserved_name`, `bad_name`, `duplicate_param` |
| 4 Check | resolved tree | typed tree, result type, warnings | `type_mismatch`, `no_matching_form`, `type_change`, `cycle`, `breaks_dependents`, `bad_range`, `empty_list_type` |
| 5 Build and compute | typed tree | rule, first value | none (runtime problems become undefined values) |

Each step is a pure function of its input and the figure. Steps 1 and 2 need no figure, so they can run in a worker and be reused for syntax highlighting. Two optional hooks look at the figure but only to name or colour things: `parseLine` takes callbacks (`isTaken`, `isObjectCommand`) that are used to name unnamed results, and `tokenize` takes the figure to colour names. Neither changes what a line means.

Error recovery: the parser stops at the first syntax error in a line (a line is short; a second error is rarely independent). The resolver and checker, however, collect up to 8 errors in one line before returning, because name and type mistakes are independent. `draw` returns the first error as the main object and the rest in `more`.

### 3.2 Normalisation and the offset map

The lexer first rewrites typographic variants, keeping an array `map[i]` from each normalised UTF-16 index to the original index. Every error, token and tooltip uses the original columns.

| Typed | Becomes | Note |
|---|---|---|
| `−` `–` | `-` | minus sign, en dash |
| `×` `·` `⋅` `∙` | `*` | |
| `÷` | `/` | |
| `≤` `≥` `≠` | `<=` `>=` `!=` | |
| `∧` `∨` `¬` | `and` `or` `not` | |
| `π` | `pi` | |
| `τ` | `tau` | |
| `∞` | `inf` | |
| `°` | postfix degree operator | see 3.5 |
| `²` `³` `⁴` … `⁹`, `⁻¹` | `^2` `^3` … | superscript digits become a power; applied to the previous primary |
| `√` | `sqrt` | `√x` and `√(x+1)` are accepted, only before a name, number or `(` |
| `“ ”` `‘ ’` | `"` and `'` | smart quotes from word processors |
| NBSP, tabs | space | |
| `\r\n` | `\n` | |

Everything is NFC-normalised first. Names accept only Latin letters, Greek letters, digits and `_` (see 3.7): anything else outside strings and comments is `bad_character`. This blocks look-alike letters from other scripts.

The input bar also accepts `<>` as `!=`, `=>` as a logic implication, and `**` as `^`. The kernel does not: the draw tool teaches one spelling per thing.

### 3.3 Tokens

| Class | Pattern | Notes |
|---|---|---|
| Number | `digits [. digits] [e [+-] digits]`, or `. digits` | `1_000` allowed (underscore between digits). Exponent only when digits follow, so `2e` is `2` times `e`, and `2e3` is 2000. A `.` followed by `.` ends the number, so `1..5` is `1`, `..`, `5` |
| Name | see 3.7 | Letters, digits, `_`, Greek |
| Command | A name starting with an upper-case ASCII letter followed by `(` | Looked up in the command table |
| String | `"` … `"` with `\"` `\\` `\n` `\{` `\}` escapes | `{expr}` and `{expr:fmt}` parts are live |
| Operator | `+ - * / ^ ! ' ° == != < <= > >= = ( ) [ ] , ; . .. :` and the words `and or not xor if in step with` | `:` only inside format specs |
| Comment | `#` to end of line, outside strings | Allowed after a line too |
| Directive start | `@` first on the line | |
| Newline | `\n` | A line ends here, unless a bracket is still open: then the next line continues it (README decision 17) |

Maximum line length 2,000 characters. Maximum token count 800. Maximum nesting depth 64 (brackets and calls): depth 64 is allowed, 65 or more is an error. These limits are `limit`-kind errors, with the specific limit in `params`, and keep the parser bounded for streamed input.

An exponent needs digits after `e`, `e+` or `e-`; otherwise the `e` is the constant. So `n = 1e+` is a `syntax` error (the `+` has no operand), not `bad_number`. A line that starts with a number directly followed by a name and then a top-level `=` (`1a = 1`) is `bad_name` ("A name cannot start with a digit") with the fix `a1 = 1`.

### 3.4 Full grammar

This replaces the grammar block in section 3 of the core design. New or changed rules are marked `(+)` and `(~)`.

```ebnf
program     = { line NEWLINE } ;
line        = [ stmt ] [ comment ] ;
stmt        = directive | define | defmany | function | rate | restyle | rerange | action ;

directive   = "@" ident { arg } ;
define      = name "=" expr [ range ] [ style ] ;
defmany     = name "," name { "," name } "=" command-call ;           (* (+) several outputs *)
function    = name "(" ident { "," ident } ")" "=" expr [ style ] ;    (* (~) one or more parameters *)
rate        = name "'" "=" expr ;
restyle     = name style ;
rerange     = name range ;                                             (* (+) change a slider's range only *)
action      = command "(" [ args ] ")" ;

range       = "in" expr ".." expr [ "step" expr ] ;
style       = "with" prop "=" value { "," prop "=" value } ;

expr        = implies ;
implies     = or ;                                                      (* no implication operator in the kernel *)
or          = xor { "or" xor } ;                                       (* (+) xor *)
xor         = and { "xor" and } ;
and         = not { "and" not } ;
not         = [ "not" ] relation ;
relation    = sum [ cmp sum { cmp sum } ] ;                             (* (~) chains, see 3.5 *)
cmp         = "==" | "!=" | "<" | "<=" | ">" | ">=" ;
sum         = term { ( "+" | "-" ) term } ;
term        = unary { ( "*" | "/" ) unary } ;
unary       = ( "-" | "+" ) unary | juxt ;
juxt        = power [ operand-after-number ] ;                          (* (+) the one implicit multiplication, see 3.5 *)
power       = postfix [ "^" signed-power ] ;
signed-power= [ "-" | "+" ] power-operand ;
power-operand = postfix [ "^" signed-power ] ;
postfix     = primary { call | index | field | "!" | "°" | tick-call } ;
call        = "(" [ args ] ")" ;
index       = "[" expr "]" ;
field       = "." ident ;
tick-call   = "'" { "'" } "(" args ")" ;                                (* (+) f'(x), f''(x) *)
primary     = number | string | "true" | "false" | name | "(" expr ")"
            | pair | polar | list | cond ;
pair        = "(" expr "," expr ")" ;
polar       = "(" expr ";" expr ")" ;                                   (* (+) (r; angle) *)
list        = "[" [ expr { "," expr } ] "]" | "[" expr ".." expr [ "step" expr ] "]" ;   (* (~) step *)
cond        = "if" "(" expr "," expr [ "," expr ] ")" ;                  (* (~) two-argument form *)
args        = arg { "," arg } ;
arg         = expr | ident "=" expr ;
```

The `juxt` rule is lexical-level in practice: after a number literal, if the next token is a name, a constant, `(`, or a built-in call, the parser inserts a multiplication node flagged `implicit`. Nowhere else.

Not in the grammar (v1): `|x|` for absolute value (use `abs`), set operators, element-of, sequences with `…`, complex numbers, vector products, derivative of a name without arguments, the `[` form of a command call, a colon after a name.

### 3.5 Operators, precedence, associativity

From tightest to loosest. Same row means same precedence.

| Level | Operators | Associativity | Notes |
|---|---|---|---|
| 1 | call `f(…)`, index `L[i]`, field `.x`, factorial `!`, degree `°`, tick-call `f'(x)` | left to right | `n!` on a non-integer is undefined `not_integer`; on a negative, `out_of_domain` |
| 2 | `^` | right | `a^b^c` is `a^(b^c)`. A sign is allowed right after `^`: `2^-1` |
| 3 | implicit multiplication (number literal then operand) | left | `2x^2` is `2*(x^2)`; `2sin(x)^2` is `2*(sin(x)^2)` |
| 4 | unary `-`, `+` | right | below `^`: `-2^2` is `-4` |
| 5 | `*`, `/` | left | |
| 6 | `+`, `-` | left | |
| 7 | `==`, `!=`, `<`, `<=`, `>`, `>=` | chain | `0 < x <= 5` means `0 < x and x <= 5` |
| 8 | `not` | prefix | |
| 9 | `and` | left | |
| 10 | `xor` | left | |
| 11 | `or` | left | |

Rules:

- **Degree.** `30°` is postfix: it multiplies its operand by the constant `deg` (= pi/180). `(a + b)°` works. `30 deg` is the same through implicit multiplication. Angles are always radians internally; the degree sign is only a way to write them.
- **Chains.** A chain may use only `<` and `<=`, or only `>` and `>=`. Mixed directions (`1 < x > 0`) and chained equality (`a == b == c`) are `chained_comparison`. `!=` is never chained. A chain of `n` operators compiles to `n` comparisons joined by `and`, with each middle operand evaluated once.
- **Unary minus vs power.** `-x^2` is `-(x^2)`. `2^-x` is `2^(-x)`. `-x!` is `-(x!)`.
- **Division and implicit multiplication.** `1/2x` is not read at all: it is the error `ambiguous_implicit` with the two readings in `fix`. Writing `1/(2x)` or `(1/2) * x` is fine. `(1/2)x` is not: a `)` followed by a name is `missing_operator` (3.6), and its quick fix is `(1/2) * x`. Reason: GeoGebra and calculators disagree here, so the safe answer is to ask.
- **Numeric equality.** For finite numbers, `==` and `!=` on Numbers compare with a relative tolerance: `|a - b| <= 1e-12 * max(1, |a|, |b|)`. Points and vectors use the same tolerance per coordinate. Text and Bool compare exactly. Comparing different types is `type_mismatch`.
- **Comparisons with an infinity.** The tolerance applies only when both sides are finite. If either side is `inf` or `-inf`, the comparison is exact: `5 == inf` and `-inf == inf` are `false`, `inf == inf` is `true`, `5 != inf` is `true`. The ordering operators follow from the infinity as a value: `5 < inf` is `true`, `5 >= inf` and `5 <= -inf` are `false`. Point and vector coordinates are compared the same way.
- **Logic on undefined.** The literal `undefined` is a Number (3.10 rule 1), so `undefined and false` is `type_mismatch`. A Bool becomes undefined when an input is undefined: with `(1/0 > 1)` undefined, `(1/0 > 1) and false` is `false`, `(1/0 > 1) or true` is `true`, and every other operation involving undefined is undefined. This keeps `if` conditions usable while a figure is partly undefined.

### 3.6 Implicit multiplication, exactly

Implicit multiplication is inserted when the previous token is a **number literal** (digits, with or without a decimal point or exponent, or a `°`-free literal) and the next token starts one of:

1. a name that is not a command (`2x`, `0.5 age`, `3 pi`, `2 deg`);
2. a built-in function call (`2sin(x)`, `3 sqrt(2)`);
3. `(` (`3(a + b)`);
4. a field-bearing name (`2 A.x`).

It is not inserted:

- between two names (`a b`, `ab` is one name): `missing_operator`, with `fix` inserting `*`;
- between a name and `(`: a name followed by `(` is a call, never a product. If the name is not callable (`m (x - A.x)` with `m` a Number), the error is `not_callable` and the `fix` is `m * (x - A.x)`;
- between `)` and `(` or a name (`(a)(b)`, `(a) b`, `(1/2)x`): `missing_operator`, with `fix` inserting `*` (`(1/2) * x`);
- between a number and a number (`2 3`): `missing_operator`;
- between a number and a command call (`2 Distance(A, B)`): allowed, because it reads naturally. This is the only exception to rule 1, since commands return objects, and the product is Number times Number or Number times Vector;
- after `/` without parentheses (see 3.5): `ambiguous_implicit`.

A number literal followed by `x(` is a call on the free variable and an error, never a product.

### 3.7 Names

```ebnf
name   = letter { letter | digit | "_" } [ subscript ] ;
letter = "A".."Z" | "a".."z" | greek ;      (* U+0370..U+03FF, letters only *)
subscript = "_" ( alnum { alnum } | "{" alnum { alnum | "," } "}" ) ;
```

- 1 to 32 characters. No leading digit, no trailing or doubled `_`, no primes (`'` is an operator).
- `P_1`, `P_12`, `P_{1,2}` are valid; the display shows a subscript. `P_1` and `P_{1}` are the same name (the kernel stores the short form).
- Case matters: `a`, `A` and `Ab` are all different. Commands are a separate namespace by position: `Name(` with an upper-case first letter looks up a command, never an object. A user object may have a PascalCase name that is not a command (`Pt`, `Lens`).
- **Reserved**, and so refused for objects (`reserved_name`): every command name; every built-in function name; the constants `pi tau e deg inf undefined`; the keywords `true false and or not xor if in step with`; the variables `t x y z`.
  Reason for `z`: kept free for 3D later. The refusal's `hint` offers the nearest valid name (`e` becomes `e_1`).
- **Scope names.** The names `i u v age` exist only inside `Particles` formulas; `k` and any binder inside `Seq` and `Map`; and function parameters. Inside such a scope the local meaning wins. Defining a global object with the same name is allowed; when a local scope hides it, the line succeeds with a `shadowed` warning (3.13).
- **Parameters.** In `f(x, y) = …` the parameters are local, may be any non-reserved name plus `x`, `y`, `t`, and may hide objects. Duplicates are `duplicate_param`.
- **Suggested names.** The input bar gives unnamed results a name. The kernel exposes `suggestName(type, taken)`:

| Type | Sequence |
|---|---|
| Point | `A B C … Z`, then `A_1 B_1 …` |
| Vector | `u v w`, then `u_1 …` |
| Line, Ray, Segment | `l m n` then `l_1 …` |
| Number | `a b c d` then `a_1 …`, skipping reserved names |
| Number with angle unit | `α β γ δ` then `α_1 …` |
| Function | `f g h p q r` then `f_1 …` |
| Circle, Arc, Curve | `c d k` then `c_1 …` |
| Polygon, Region | `P_` is taken by points, so `poly1 poly2 …`, `reg1 …` |
| Text | `text1 text2 …` |
| List | `L M N`, then `L_1 …` |
| Bool | `cond1 cond2 …` |
| Particles | `fx1 fx2 …` |

The first free name in the sequence wins. Names reserved or taken are skipped.

### 3.8 What a definition makes

Core section 3 gave a table. It is extended here. "Free" variables in this table means `x` or `y` used outside any function parameter list.

| Right-hand side (after type check) | Object |
|---|---|
| Number expression with no free variables | Number. With `in a..b`, a slider |
| Number expression using `t` | dependent Number |
| `true`, `false`, a relation with no free variables, `and`/`or`/`not` of Bools | Bool |
| String | Text |
| `(e, e)` with Number parts | Point |
| `(r; θ)` | Point (converted at build time to Cartesian) |
| List literal or range | List of one element type |
| A command call | The command form's return type |
| Relation with free `x` or `y` (`==`, `<`, `<=`, `>`, `>=`) | By shape, see 3.9 |
| `if(c, a, b)` | Type of `a` and `b` (they must agree) |
| `f(x)` call or a field of a point | Number, as typed by the callee |
| `f + g`, `2 f`, and `h(x) = f(g(x))` with `f`, `g` functions | Function |
| A bare function name (`h = f`) | Function (an alias is a new dependent object with its own style) |

A free variable in any other place is `free_variable`: `a = x + 1` fails with a hint to write `a(x) = x + 1` or to use an existing number. The same holds for a composition: `h = f(g(x))` has a free `x`, so it is `free_variable` with the fix `h(x) = f(g(x))`.

### 3.9 Equations versus assignments

The core design already reserves `=` for defining and `==` for equality. This section settles the part that GeoGebra overloads.

1. `=` never builds an equation. `3x + 4y = 12` is `assign_in_expr` at the `=` (col 9, endCol 10), with `expected: ["=="]` and a `fix` that writes `==` and wraps it in the line kind it needs, for example `l = Line(3x + 4y == 12)`.
2. A relation (`==`, `<` …) whose operands mention a free `x` or `y` becomes an implicit object. A relation with no free variables is a Bool.
3. The relation is moved to the form `p(x, y) ⋈ 0` and classified, by symbolic expansion to a polynomial when possible (degree at most 2 in v1; otherwise treated as a general implicit curve):

| After expansion | Object |
|---|---|
| `a*x + b*y == c` with `(a, b) ≠ 0` | Line |
| `x == c` or `y == c` | Line (vertical or horizontal) |
| `(x - h)^2 + (y - k)^2 == r2` where `r2` works out to a number greater than 0 | Circle |
| Other degree-2 equation | Curve (implicit), tagged `conic` for drawing and for `Tangent` |
| Anything else with `==` | Curve (implicit) |
| `<` `<=` `>` `>=` | Region (half-plane for linear, otherwise implicit region) |
| `y == f-of-x` where x only: `y == x^2` | Curve (implicit), and a hint in the AV that `f(x) = x^2` is the function form |

**A circle needs a radius known at check time.** The type of an object cannot change when a slider moves, so a value test such as `r2 > 0` cannot be made while `r2` depends on an object. The checker expands the relation and cancels the centre terms; the result is a Circle only when `r2` is then a plain number. `(x - 2)^2 + (y + 1)^2 == 9` is a Circle, and so is `(x - a)^2 + (y - b)^2 == 16` for any objects `a` and `b`, because the centre cancels. `x^2 + y^2 == a^2` with a slider `a` has an `r2` that depends on `a`, so it is a conic `Curve`. To get a circle that follows a slider, write `Circle(O, a)`.
4. `y == x^2` is allowed but is not a Function. Teachers who want a function write `f(x) = x^2`. The reason: a Function value can be called, integrated and differentiated; an implicit curve cannot.
5. The type `Relation` exists inside command arguments only. `Line(3x + 4y == 12)` and `Curve(x^2 - y == 0)` take a `Relation` and build the object.
6. Redefining a Line as another Line is fine; redefining it as a Circle is `type_change`.

### 3.10 Types and inference

Types are the ones in core section 4, plus `Relation` (arguments only) and three refinements:

- `Function` is `Function<R>` with `R` in `Number` or `Point`, and a parameter count `n` (1 to 4). `f(x) = (cos(x), sin(x))` is a `Function<Point>` of one parameter. `Curve` accepts one.
- `Number` has an optional **unit tag** (`'angle'` or none) carried with the object, never with the type. `Angle` returns a tagged Number. Arithmetic keeps the tag only when it is preserved obviously (`angle + angle`, `angle * number`, `-angle`, `angle / number`); every other result is untagged. The tag only drives display and slider range.
- `List<T>` where `T` is any non-list type. Nested lists are `List<List<T>>` (a matrix) with equal row lengths checked at build time when sizes are literals.

**Type values.** A type in a result is a `Ty` object, not a bare `TypeName` string: `{ k: 'Number' }`, `{ k: 'List', of: … }`, `{ k: 'Function', ret: 'Number', arity: 2 }`. `tyStr(ty)` gives the text form used in messages and summaries, for example `Function<Number>(2)`.

**Inference** is bottom-up with one top-down hint. The checker types below (`CheckCtx`, `infer`, and `matchForms` in 3.11) are internal and not exported; the public surface is `parseLine`, `parseProgram`, `checkLine`, `analyseLine`, `compileLine`, `preview`, `signatureHelp`, `complete`, `tokenize`, `suggestName` and the table builders (`createCommandTable`, `checkTable`).

```ts
interface CheckCtx {
  figure: FigureView;          // read-only lookup of objects by name
  scope: ScopeStack;           // local binders: function params, Seq/Map binders, Particles names
  expected?: TypeName;         // hint from the parameter type of a command form, else undefined
}
function infer(node: ResolvedExpr, cx: CheckCtx): Typed;
```

Rules, in order:

1. Literals have their type; `undefined` has type `Number` with an `explicit` undefined value.
2. A name has the type of its object, or the local binder's type (parameters are `Number`).
3. Binary operators use the operator table below: exact match on both operand types, in table order, no coercion. No row means `type_mismatch` listing both types and the nearest legal operators.
4. A call on a Function object: argument count equals `n`; each argument is `Number`; the result is `Number` or `Point` by `R`. Calling with a `List<Number>` is `type_mismatch` (no mapping; use `Map`).
5. A call on a built-in: look up its signature set and apply the same matcher as commands (3.11).
6. `if(c, a, b)`: `c` must be `Bool`; `a` and `b` must have the same type, or one of them is `undefined` (an `undefined` literal adopts the other side's type). With two arguments the false branch is `undefined` with reason `condition_false`.
7. List literal `[e1, e2, …]`: all elements the same type; a mix of `Point` and `Number` is `type_mismatch` with the first conflicting position. An empty list `[]` takes `expected` if it is a `List<T>`; otherwise it is `empty_list_type`. A range `[a..b]` has type `List<Number>`.
8. `L[i]`: `L` must be a list, `i` a Number. Result `T`. A literal `i` that is not a positive integer is a warning `index_literal`; a runtime out-of-range index gives undefined `index_out_of_range`.
9. Field access: Point and Vector have `.x .y`; Vector also `.length`; Segment has `.length .start .end`; Circle `.center .radius`; Arc `.center .radius .start .end`; Polygon `.vertices` (List<Point>) `.area .perimeter`; Line `.point .direction`; Text `.length`. Other combinations are `type_mismatch` listing the available fields.
10. Text interpolation `{e}` or `{e:fmt}`: `e` may be Number, Bool, Text, Point, Vector. `fmt` is `2` (decimals), `.3` (significant figures), `d` (degrees from radians), `f` (fraction), `%`. Other formats are `bad_format`.

**Operator table** (left type, operator, right type, result type; `*` rows are in table order):

| Left | Op | Right | Result |
|---|---|---|---|
| Number | `+ - * / ^` | Number | Number |
| Number | `*` | Vector | Vector |
| Vector | `*` and `/` | Number | Vector |
| Vector | `+ -` | Vector | Vector |
| Point | `+ -` | Vector | Point |
| Point | `-` | Point | Vector |
| Vector | `-` unary | | Vector |
| Function<Number> | `+ - * /` | Number or Function<Number> | Function<Number>, pointwise |
| Number | `+ - *` | Function<Number> | Function<Number> |
| Function<Number> | `^` | Number | Function<Number> |
| Text | `+` | Text | Text |
| Bool | `and or xor` | Bool | Bool |
| any T in {Number, Bool, Text, Point, Vector} | `== !=` | the same T | Bool |
| Number | `< <= > >=` | Number | Bool |
| List<Number> | `+ - * /` | Number | List<Number> (element-wise; the list is on the left) |

No other pairs. The list row has the list on the left only: `L * 2` works, and `2 * L` is `type_mismatch` ("Number * works with: Number, Vector, Function"); write `L * 2`. `Point * Number`, `Point + Point` and `Vector * Vector` are `type_mismatch`, with a hint: `Vector(A)` makes a position vector from a point, `dot(u, v)` and `cross(u, v)` exist. This keeps core section 4's "nothing converts silently" and adds only `Point - Point = Vector`, `Vector(Point)`, element-wise list arithmetic with a scalar, and function arithmetic.

Function arithmetic builds a new function object `(f + g)(x) = f(x) + g(x)` as a dependent rule. `2f` and `f + 1` are also allowed in definitions (`h = 2 f + 1`). They are always functions, so a Number expression can never hide a function value.

### 3.11 Command argument matching

Core section 5 chooses "the first form whose parameter count and types match exactly". We keep exactness but make it order-independent and diagnosable.

```ts
type ParamKind = 'value' | 'binder' | 'body';

interface ParamSpec {
  readonly name: string;
  readonly type: string;             // text: 'Number', 'List<Point>', 'Number|Point', 'Function<Number>', 'Relation', 'Any', or an alias such as 'Shape', 'Path', 'Curvelike'
  readonly optional?: boolean;
  readonly kind?: ParamKind;         // default 'value'
  readonly default?: ConstValue;     // used when optional and omitted
}

interface ArgProblem {
  argIndex: number;                  // -1 when an argument is missing; args.length when extra
  param?: string;
  expected: string;                  // e.g. "Number or Point"
  got: string;                       // "Line", "missing", "extra"
  span: Span;
}

type MatchResult =
  | { ok: true; form: CommandForm; args: BoundArg[] }
  | { ok: false; closest: CommandForm; problems: ArgProblem[]; forms: string[] };

function matchForms(spec: CommandSpec, args: ParsedArg[], cx: CheckCtx): MatchResult;
```

`matchForms` is internal: callers see its outcome as the typed `command` node in a `CheckedLine`, or as a `no_matching_form` error.

Algorithm:

1. **Split arguments.** Positional first, then named. A named argument after a positional one that is already bound to the same parameter is `duplicate_arg`. A named argument whose name is not a parameter in any form is reported with the nearest parameter names.
2. **Type each value argument once**, without an expected type, except literals that need one (`[]`, an empty list) and relation arguments (typed as `Relation`). Binder arguments are bare identifiers and are not typed. Body arguments wait for step 4.
3. **Filter forms by arity.** Required count to total count, counting named arguments.
4. **Test each remaining form.** For each parameter in order, the argument type must be a member of `ParamSpec.type`. Binder parameters introduce a local name of type `Number` (or `Point` for point binders) in a child scope. Body arguments are then inferred in that scope with `expected` set to the parameter type.
5. **Select.** Collect the passing forms. If exactly one passes, use it. If more than one passes, choose the form whose parameter types are most specific (a concrete type beats an alias). The table builder proves at load time that this always leaves exactly one winner for every combination of concrete argument types (the "no ambiguous overloads" test, run in CI); at run time two winners is a bug and returns `internal`.
6. **Fail with a diagnosis.** If no form passes: pick the *closest* form. First prefer the forms whose argument count fits; among them take the one with the fewest problems. Only if no form fits the count, take the fewest problems overall, ties broken by smaller arity difference, then table order. So for `Circle(A, 2, 3)` the three-point form comes first. Produce `problems` for it, and `forms` listing every form with the closest first.

The error kind and span depend on what went wrong:

- No form fits the argument count: `arg_count` (its own kind, not `bad_arity`), with the span of the whole call.
- The count fits and one argument has the wrong type: `no_matching_form`, with the span and `token` of that argument. `Distance(A, 5)` points at the `5` (col 17).
- The count fits and more than one argument is wrong: `no_matching_form`, with the span of the whole call.

The message names the closest form and the first problem: `Circle: argument 2 should be a Number or Point, but B is a Line.` The full list is in `forms`.

**Optional parameters** are filled with their `default` before the rule is built. A form's catalogue line shows them in brackets.

**Binders and bodies.** `Seq(k^2, k, 1, 10)` has parameters `(body: Number, k: binder, from: Number, to: Number)`. The binder `k` is a fresh local name; the body is checked in a scope containing `k: Number`. The kernel treats the body as a mini-function, so its inputs are tracked and the rule re-runs only when something it reads changes.

**Aliases.** `Shape` = Point, Segment, Ray, Line, Circle, Arc, Polygon, Curve, Vector. `Path` = Segment, Ray, Line, Circle, Arc, Curve, Function. `Curvelike` = Function<Point>, Curve. `Scalar` = Number.

### 3.12 Redefinition, rename, delete

**Redefinition** (`A = …` on an existing `A`, or `f(x) = …` on an existing function):

1. Parse and resolve with the new text. Names that appear later in the figure than `A` are allowed.
2. **Cycle test.** Depth-first search from the new inputs through their inputs; reaching `A` is `cycle`, with the chain of names in `path`. Only value edges and slider range edges join the test. A range bound may not read the slider itself or anything downstream of it: `a = 3 in 0..a`, and `a = 3 in 0..b` with `b = a + 1`, are `cycle`. Style edges never form a cycle (kernel design 9.2): a style may read its own object or its dependents, so `P with showIf = P.x > 0` and `a = 3 in 0..20 with opacity = a / 20` are accepted. Only value edges decide free versus dependent.

   On a defining line, the name being defined resolves to the new object inside the `with` list, so `P9 = (1, 2) with showIf = P9.x > 0` and `c1 = (1, 2) with opacity = c1.x / 10` are accepted even when `P9` and `c1` do not yet exist, and no cycle edge is added. A range bound on a defining line may not read the name: `k = 3 in 0..k` is `unknown_name` while `k` is new and `cycle` once `k` exists.
3. **Type test.** Result type equals old type (`Function<R>` must keep `R`; list element type must stay). Different is `type_change`. Parameter count of a function may change.
4. **Dependents test.** Re-check the objects that read `A` directly against the new signature. Direct readers are enough: a changed type is already `type_change` (step 3), and a function's parameter count is the only signature that can change without one, so an object further down cannot break unless its direct reader breaks first. Failures are collected into `breaks_dependents` with their names and the error each would give.
5. **Move.** If a new input is later in creation order, move `A` and its downstream objects after it, keeping their relative order. The move is an entry in the undo log.
6. **Free to dependent and back.** `a = 3` on a dependent number turns it into a free number (its old rule is dropped). `a = b + 1` on a free number makes it dependent. Style, `id` and any slider range are kept only if still meaningful: dependent numbers lose their slider; a number that becomes free keeps no range.
7. **Commit.** One undo entry holds the old definition.

**Rename** is `Rename(A, "P")`. It checks `bad_name`, `reserved_name`, `name_taken`. Dependents store references by `id`; only their displayed source changes, so no text is rewritten.

**Delete** is `Delete(A)`; the result lists every object removed (A and its downstream objects).

### 3.13 Warnings

A successful line may carry warnings. They do not block the commit.

```ts
interface Notice { severity: 'info' | 'warning';
                   code: string;                                  // L201 to L205 for the kinds below
                   kind: 'shadowed' | 'index_literal' | 'precision_loss' | 'clamped' | 'unused_binder';
                   message: string; params: Record<string, string | number | boolean | string[]>; names?: string[] }
```

This is the shared `Notice` of `docs/features/errors/design.md` 3.1. A successful result carries them in `notices`; there is no separate `Warning` type.

- `shadowed`: a parameter or binder hides a figure object.
- `index_literal`: a literal list index is `0`, negative, or not an integer.
- `precision_loss`: an integer literal above 2^53 was rounded.
- `clamped`: a free number was set outside its range and clamped.
- `unused_binder`: `Seq(3, k, 1, 5)` ignores `k`.

### 3.14 Built-in functions and constants

All built-ins are lowercase, pure, and have signatures in the same table shape as commands (`FunctionSpec` with `forms`). They are callable only with parentheses, with no space needed before `(`. A call with the wrong argument count is `arg_count`, and a call with a fitting count but wrong types is `no_matching_form`; both list the forms (3.11).

#### Constants

| Name | Value |
|---|---|
| `pi` | 3.14159… |
| `tau` | 2 pi |
| `e` | 2.71828… |
| `deg` | pi / 180, so `30 deg` is 30° in radians |
| `inf` | positive infinity; allowed in any Number position, and `out = inf` stores positive infinity (`docs/features/README.md`, decision 7). Arithmetic on finite numbers that overflows (`10^400`, `fact(200)`) gives undefined `overflow`; a result that is not a number, such as `inf - inf` or `0 * inf`, gives undefined `not_finite`. A slider bound must be finite: `a = 3 in 0..inf` is `bad_range` |
| `undefined` | the undefined Number, reason `explicit` |
| `true`, `false` | Bool |

#### Functions

| Group | Names and forms | Undefined when |
|---|---|---|
| Trig | `sin(x) cos(x) tan(x) sec(x) csc(x) cot(x)` | `tan`/`sec` at odd multiples of pi/2: `division_by_zero` when exactly zero denominator, otherwise a large finite value; `csc`/`cot` at multiples of pi: same |
| Inverse trig | `asin(x) acos(x)`: `[-1, 1]`; `atan(x)`; `atan2(y, x)`; `acot(x)` | outside the domain: `out_of_domain`. `atan2(0, 0)`: `out_of_domain` |
| Hyperbolic | `sinh cosh tanh sech csch coth asinh acosh atanh` | `acosh` below 1, `atanh` outside (-1, 1), `coth`/`csch` at 0: `out_of_domain` or `division_by_zero` |
| Powers and roots | `sqrt(x)` `cbrt(x)` `nroot(x, n)` `hypot(a, b)` `pow(a, b)` | `sqrt` of negative: `out_of_domain`. `nroot` with even `n` and negative `x`: `out_of_domain`; odd `n` returns the real root |
| Exp and log | `exp(x) ln(x) log10(x) log2(x) log(b, x)` | `ln` of 0 or negative: `out_of_domain`. `log(b, x)` with `b <= 0` or `b == 1`: `out_of_domain`. One-argument `log(x)` is refused: `arg_count` with hint "use ln, log10 or log2" |
| Rounding | `floor ceil round trunc fract` and `round(x, digits)` | never |
| Sign and size | `abs(x)` `sign(x)` `min(a, b, …)` `max(a, b, …)` `clamp(x, lo, hi)` | `clamp` with `lo > hi`: `out_of_domain` |
| Modular | `mod(a, b)` (result has the sign of `b`) `rem(a, b)` (sign of `a`) `gcd(a, b)` `lcm(a, b)` | `b == 0`: `division_by_zero`. `gcd`/`lcm` on non-integers: `out_of_domain` |
| Counting | `fact(n)` and postfix `n!`; `ncr(n, r)`; `npr(n, r)` | non-integer: `not_integer`; negative: `out_of_domain`. Result above 1.8e308: `overflow` |
| Special | `gamma(x) beta(a, b) erf(x) erfc(x)` | `gamma` at 0 and negative integers: `out_of_domain`; `beta` with a non-positive argument: `out_of_domain` |
| Interpolation | `lerp(a, b, s)` `smooth(e0, e1, x)` (smoothstep) `step(e, x)` | `smooth` with `e0 == e1`: `division_by_zero` |
| Random | `rand(seed)` in [0, 1), `noise(x)` `noise(x, y)` `noise(x, y, z)` in [-1, 1] | never; `seed` must be finite |
| Vector | `dot(u, v)` `cross(u, v)` (scalar, 2D) `norm(u)` `unit(u)` `perp(u)` | `unit` of the zero vector: `division_by_zero` |
| Angle | `todeg(x)` `torad(x)` | never |
| Colour | `rgb(r, g, b)` `rgb(r, g, b, a)` `hsl(h, s, l)` `hsl(h, s, l, a)` | never; components are clamped to range |
| Conversion | `Vector(Point)` (command), `number(Text)` parses a decimal | `number` of non-numeric text: `out_of_domain` |
| Text | `len(Text)` | never |

About 75 names counting hyperbolic and inverse families. Only `min` and `max` also take a list: `max(L)` for `List<Number>`; an empty list gives undefined `empty_list`. `abs(L)` is `no_matching_form`. `sum` and `mean` are not built-in functions; they belong to the list commands. Names intentionally absent in v1: complex-number functions (`arg`, `conjugate`, `real`, `imaginary`), polygamma and zeta, integral functions (`si`, `ci`, `ei`), Lambert W, regularised gamma and beta. They are reserved so users cannot take the names.

#### Numeric behaviour

- All values are IEEE double precision. A NaN result, or an infinite result from finite inputs, is stored as undefined (`not_finite`, `overflow` or `out_of_domain` by cause). The constant `inf` itself is a valid stored value (see the constants table).
- `sin`, `cos`, `tan` reduce their argument by an exact method, so `sin(pi)` is `1.2246e-16` as in IEEE but shown as `0` after display rounding; the language does not special-case multiples of pi, to stay predictable. `sin(180 deg)` shows `0`.
- Accuracy: elementary functions within 1 ulp of the platform maths library in v1. Because platform libraries differ in the last bit between engines, film replay across browsers may drift in chaotic simulations. The function table is accessed through an interface (`MathLib`) so a bit-exact port can replace the platform one without changing callers; the acceptance test is two engines producing identical bytes for 1e6 samples of each function.
- Speed target, per function per redraw: a 2,000-sample batch of a 20-node function takes under 0.2 ms in V8 (about 200 million node-evaluations per second). Ten such functions then cost about 2 ms per redraw. Measured: 170 to 230 million node-evaluations per second; a 2,000-sample batch of a 30-node function with `sin`, `cos` and `sqrt` takes 0.26 ms.

### 3.15 Evaluation and compile target

Typed trees compile once, at build time, to JavaScript closures over a flat value environment (no `eval`, no `new Function`, so CSP-safe).

```ts
type Num = (env: Env) => number;           // NaN is the internal undefined marker for Numbers
interface Compiled<T> { eval: (env: Env) => T; reads: ReadonlySet<ObjectId>; usesT: boolean }
```

- `reads` is the set of object ids the expression reads. The rule's inputs and the downstream lists come from it directly; no separate dependency scan.
- Undefined is carried as NaN with a side channel: a numeric closure that detects a domain problem writes the reason code into `env.reason` before returning NaN. The first reason set in an evaluation wins, so `ln(0) + sqrt(-1)` reports `out_of_domain` from `ln`. Each object stores `{ reason, detail?, cause? }` (the shared undefined value, README decision 2), where `cause` is the nearest undefined input, a direct input of this object that was already undefined (a cascade). Following the `cause` links reaches the root.
- Constant folding runs at build time on subtrees with no reads and no `t`.
- A Function object compiles to `(x: number) => number` plus a batch form `(xs: Float64Array, out: Float64Array) => void` that the plotter uses; the batch form reuses the same closure tree with a loop in each node when profiling shows a gain.

### 3.16 Previews

`kernel.preview(source): PreviewResult` runs steps 1 to 5 against a copy-on-write overlay of the figure. Nothing is committed, no downstream lists are rebuilt, and the preview object is given the next suggested name if unnamed. Cost target under 1 ms for typical lines; the input bar calls it at most every 100 ms after a pause in typing.

```ts
type PreviewResult =
  | { ok: true; name: string; type: Ty | null; valueText: string; warnings: Notice[]; ghost: GhostSpec | null }
  | { ok: false; incomplete: boolean; error: KernelError };   // incomplete: the only problem is that input ends too soon
```

`type` is a `Ty` object (3.10), or `null`. The `warnings` entries are `Notice` objects (3.13).

### 3.17 Syntax help

`signatureHelp(source, cursor, figure): SignatureHelp | null`:

```ts
interface SignatureHelp {
  command: string;                   // "Circle"
  forms: { text: string; summary: string; matches: boolean; active: boolean }[];
  activeParam: number;               // index into the active form
  argsSoFar: { type: string; span: Span }[];            // type text from tyStr, or 'unknown'
}
```

Algorithm: from the cursor, find the innermost open call with the token scan (3.18); count commas at that depth to get the argument index; type the complete arguments to the left of the cursor; mark every form `matches` whose first `k` parameter types accept those types; mark the first matching form `active`. If no form matches, mark the closest one active and show the problem inline. Cost: one token scan plus typing of at most the arguments to the left.

### 3.18 Autocomplete

```ts
interface Completion {
  label: string;            // what the list shows
  insert: string;           // text to insert; may contain $1, $2 placeholders
  kind: 'object' | 'command' | 'function' | 'constant' | 'keyword' | 'field' | 'property' | 'directive' | 'snippet';
  detail?: string;          // type, or one-line form
  doc?: string;             // summary from the command table
  score: number;
}
function complete(source: string, cursor: number, figure: FigureView, opts?: { limit?: number }): Completion[];
```

Completion and signature help do not use a second, error-recovering grammar. They scan the tokens to the left of the cursor (bracket stack, commas, last token) and run the normal parser on the arguments that are already finished. The scan classifies the position:

| Position | Offers |
|---|---|
| Start of line, empty prefix | Directive start `@`, comment `#`, snippets for `name =`, `f(x) =`, and action commands |
| Start of line, a prefix | Action commands, existing object names (for `A with …`, `a in …`), then snippets |
| After `=` | Commands whose return type is plausible, built-ins, constants, object names |
| Inside call args, parameter `k` of the matching forms | Objects whose type is accepted by parameter `k` of at least one matching form, ranked above others; commands that return that type; constants if `Number` |
| After `.` | The fields of the left operand's type |
| After `with` or `,` in a style list | Property names; after `prop =` the legal values |
| After `@` | Directive names |
| Inside a string, in `{ }` | Object names and fields |
| After `in` | `lo..hi` snippet |

Because this is a scan and not a recovering parser, it cannot see every position. Known gaps: after `prop =` (for example `A with color = `) the legal values, such as colour words, are offered only once a letter is typed, and the fields after `.` inside the `{ }` of a text are not offered.

Ranking (higher is better): prefix match on the word, 1000; case-insensitive prefix, 800; word-boundary subsequence (`mp` matches `Midpoint`), 500; typo match within edit distance 1 (2 for words of 6 or more letters), 200; then type fit bonus (accepted by active parameter) +300; recently used or most recently created object +100 decreasing by 10 per step back; commands with an exact form match for the arguments already typed +150. Limit defaults to 12. A completion for a command inserts `Name($1, $2)` with parameter names as placeholders, using the closest active form.

Performance: objects and command names live in sorted arrays with a precomputed lower-case copy and a character-bigram index for the subsequence match. Target under 2 ms per keystroke for 5,000 objects and 200 names.

### 3.19 Edge cases

- **Empty and comment-only lines** are no-ops: `ok: true, noop: true`.
- **Trailing commas** `Circle(A, 2,)` are `syntax` with `expected: ["expression"]`.
- **A name on its own** (`A`) defines nothing. It is `syntax` with `expected: ["=", "with", "in", "'"]`. The draw tool's `figure` call is how to read a value.
- **Self-reference** `a = a + 1` is `cycle` (even when `a` does not yet exist it is `unknown_name`; after creation it is `cycle`). There is no mutable assignment.
- **Very large or small literals**: `1e400` is `bad_number` (`out_of_range`); `1e-400` is `0` with a `precision_loss` warning.
- **Unicode digits** from other scripts are `bad_character` with a hint to use ASCII digits.
- **Mixed `,` and decimal comma**: `1,5` is two arguments or a pair, never 1.5; there is no locale-specific decimal mode in v1.
- **Line breaks inside brackets** continue the line (README decision 17). Input that ends with a bracket still open is `unbalanced`, pointing at the unmatched opener.
- **Command names used as variables**: `Line = 3` is `reserved_name`.
- **Redefining `t`** or any directive-owned name is `reserved_name`.
- **Large ranges**: `[1..1000000]` is `limit` (cap 100,000 elements per list, 1,000,000 elements total per figure).

## 4. Better than GeoGebra

1. **One lexer and one grammar for everything**, with no CAS flags and no spreadsheet-cell names. Highlighting, completion, preview and the draw tool share the lexer and the parser.
2. **No guessing.** Unknown names, name-before-parenthesis, adjacent names and `=` as an equation are all errors with a precise fix. GeoGebra's implicit product and function-or-product ambiguity are gone.
3. **Positions survive.** The offset map makes every error column right, even after normalisation.
4. **Error data a model can use**: `expected`, `forms`, `fix` (a full replacement line), `quickFixes`, and `related` spans.
5. **Order-independent forms**, proven by a table test, and a closest-form diagnosis with per-argument problems, instead of "illegal argument".
6. **Typing is separate from algorithm creation**: one table gives type checking, errors, catalogue, autocomplete, signature help and docs. GeoGebra keeps these in separate places.
7. **Dry-run previews** cost almost nothing because checking is pure and the figure is copy-on-write.
8. **Redefinition is an in-place transaction** with a dependents check, not a rebuild from a serialised construction.
9. **Ambiguity is named**: `1/2x`, `a b`, `f(x)` as a product are errors with both readings shown, not silent choices.
10. **Undefined has reasons and a cascade link** (`cause`), so a teacher hears "the line is undefined because B is undefined".
11. **Strong types for functions**: Function arithmetic is explicit and typed (`Function<Point>` for parametric curves) rather than a union of ad hoc cases.
12. **Deterministic maths interface** from the start, so films can later be made bit-exact across browsers.

## 5. Changes to the core design

1. **Section 3 grammar** is replaced by 3.4 here: adds `defmany`, `rerange`, polar `(r; θ)`, `xor`, two-argument `if`, chained comparisons, `°` postfix, tick calls `f'(x)`, list ranges with `step`, trailing comments, and multi-parameter functions.
2. **Section 3 implicit multiplication** is kept, with two additions: it also applies before a command call, and `a/2x` is `ambiguous_implicit`.
3. **Section 3 reserved names** add `tau deg inf undefined z` and every built-in. User names may not be `x y t z`, but function parameters may.
4. **Section 4 types**: add `Relation` (command arguments only); `Function` becomes `Function<R>` with parameter count; add the Number unit tag `'angle'` (so `Angle` stays a Number in radians but displays as degrees); allow `Point - Point = Vector`, element-wise `List<Number>` and scalar arithmetic, and function arithmetic.
5. **Section 3 definition table**: equations with free `x`/`y` produce Line, Circle, Curve or Region; `=` never builds an equation; Bool relations require no free variables.
6. **Section 5 `CommandForm.params`** gain `kind` (`'value' | 'binder' | 'body'`), `default`, and alias types; `CommandSpec` gains `describe?: string` (a template used by the Algebra view, see `algebra-view/design.md`) and forms may return a tuple for `defmany`.
7. **Section 5 matching rule** becomes order-independent (specificity, proven at table build) with the closest-form diagnosis.
8. **Section 9 errors** gain: `more`, `fix`, `quickFixes`, `related`, `warnings`, `severity`, and the new kinds listed in `errors.md`.
9. **Section 6.6 actions** add `Rename(obj, Text)`.
10. **Section 7 `Particles` names** `i u v age` are scope-local; a global object with that name is allowed with a `shadowed` warning.
11. **Section 13 open question 3** (LaTeX in texts): this design uses `$…$` only for display math inside Text, not in expressions.
12. **New kernel API**: `preview`, `suggestName`, `signatureHelp`, `complete`, all pure.

## 6. Sources studied

GeoGebra source (commit 3608374, read-only):

- `source/shared/common/src/main/javacc/org/geogebra/common/kernel/parser/` (the grammar file)
- `source/shared/common/src/main/java/org/geogebra/common/kernel/parser/`
- `source/shared/common/src/main/java/org/geogebra/common/kernel/arithmetic/`
- `source/shared/common/src/main/java/org/geogebra/common/plugin/` (the operation list)
- `source/shared/common/src/main/java/org/geogebra/common/kernel/commands/` (dispatcher, command processors, the algebra processor)
- `source/shared/common/src/main/java/org/geogebra/common/kernel/geos/` (label handling)
- `source/shared/common/src/main/java/org/geogebra/common/main/MyError.java` and `main/localization/` (error kinds, autocomplete provider)
- `source/shared/common/src/main/java/org/geogebra/common/kernel/ScheduledPreviewFromInputBar.java`
- `source/shared/common/src/main/java/org/geogebra/common/util/AutoCompleteDictionary.java`

Manual pages:

- https://geogebra.github.io/docs/manual/en/Predefined_Functions_and_Operators/
- https://geogebra.github.io/docs/manual/en/Naming_Objects/
- https://geogebra.github.io/docs/manual/en/Input_Bar/
- https://geogebra.github.io/docs/manual/en/Algebra_View/
