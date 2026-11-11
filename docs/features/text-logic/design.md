# Text, typeset maths, dynamic text, and logic commands: design

Status: draft for review. Follows `docs/design/formula-language-and-kernel.md` and the language, kernel and errors designs under `docs/features/`.

This folder covers:

1. **Text objects**: static text, dynamic text (parts that follow other objects), typeset maths inside text (`$…$`, LaTeX), placement, rotation, styles.
2. **Text commands**: `Text`, `LaTeX`, `FormulaText`, `FractionText`, `SurdText`, `ScientificText`, `TableText`, `VerticalText`, `RotateText`, `Ordinal`, `ContinuedFraction`, `ReplaceAll`, `Split`, `LetterToUnicode`, `TextToUnicode`, `UnicodeToText`, `UnicodeToLetter`.
3. **Logic commands**: `if` and `cases`, `CountIf`, `KeepIf`, `IsInteger`, `IsDefined`, `IsInRegion`, `Relation` (and `Related`), plus the logical operators.
4. The **math layout engine** that draws all typeset maths in the product (texts, CAS output, labels).

The symbolic layer (`../cas/`) supplies `toLatex` and `toText` for expressions; this area draws what it produces.

No GeoGebra code, text or names are used here. Command names that are ordinary words (Text, Split, Ordinal) are listed because a teacher says them.

---

## 1. What the features do

### For the learner

- Read labels, captions and explanations placed in the figure, some of which update as they drag ("The area is 12.50 square units").
- See formulas typeset as in a book: fractions stacked, roots with a bar, exponents raised, matrices in brackets.
- See numbers shown the way a lesson needs: two decimals, three significant figures, a fraction, a surd, scientific notation, "3rd".
- Ask the figure a yes/no question: are these two lines parallel? Is this point inside that shape? Does this hold only now, or always?

### For the teacher (the live AI voice)

- Put words in the figure while speaking: a title, a label next to a point, a live readout inside a sentence.
- Say a formula and show it typeset in the same instant: `Text("$A = \frac{1}{2} b h$", (1, 4))`.
- Have a statement that changes with the figure: `Text("The angle is {θ:.0deg}, so the triangle is {if(θ < 90deg, "acute", "not acute")}.", (0, 5))`.
- Check a geometric claim before saying it: `Relation(l1, l2)` returns a sentence such as "l1 and l2 are parallel, and always will be, because of how l2 was built."
- Count and filter lists to say "7 of the 12 points are inside".

### Sub-features

| # | Sub-feature | Phase |
|---|---|---|
| 1 | Text object: literal text, live parts `{expr:fmt}`, math `$…$` | 1 |
| 2 | Placement: world coordinates, screen coordinates, anchored to an object, anchor corner, alignment | 1 |
| 3 | Style: size, bold, italic, serif, colour, background, border, rotation, vertical | 1 |
| 4 | Math layout engine with a LaTeX subset (section 6) | 1 |
| 5 | Full LaTeX fallback for unsupported macros (DOM overlay) | 2 |
| 6 | `Text`, `LaTeX`, `FormulaText` | 1 |
| 7 | `FractionText`, `SurdText`, `ScientificText`, `Ordinal`, `ContinuedFraction` | 1 |
| 8 | `TableText` | 1 |
| 9 | `VerticalText`, `RotateText` | 1 |
| 10 | `ReplaceAll`, `Split`, `LetterToUnicode`, `TextToUnicode`, `UnicodeToText`, `UnicodeToLetter` | 1 |
| 11 | `if`, `cases`, `CountIf`, `KeepIf`, `IsInteger`, `IsDefined`, `UndefinedReason`, `IsInRegion` | 1 |
| 12 | `Relation`, `Related` with by-construction knowledge | 1 (basic set), 2 (full) |
| 13 | Text editing in place; picking objects to insert | 1 |
| 14 | Localised ordinals and number formats | 3 |

---

## 2. The text value

### 2.1 Types

Ruling K5 (`../kernel/rulings.md`): the kernel does not wrap values in a `{ t, ... }` union; it stores the language's raw runtime values, and the type comes from the object's `type`. The union below lists the shapes this area adds, with `t` standing for that `type`.

```ts
type Value =
  | /* … existing … */
  | { t: 'Text'; v: string; parts?: readonly TextPart[]; table?: TableSpec };   // v is the flattened string

type TextPart =
  | { p: 'lit'; s: string }                              // literal characters
  | { p: 'math'; src: string; display?: boolean }        // $…$ : LaTeX-subset source (section 6)
  | { p: 'ref'; obj: ObjId; fmt: Format }                // {name:fmt}, live
  | { p: 'expr'; node: number; fmt: Format };            // {expr}: a small computed expression, node id in the kernel's tree store

type Format =
  | { f: 'auto' }
  | { f: 'fixed'; digits: number }                       // {x:2}
  | { f: 'sig'; digits: number }                         // {x:3sf}
  | { f: 'deg' }                                         // radians shown as degrees
  | { f: 'frac'; maxDen?: number }                       // {x:f}
  | { f: 'pct'; digits?: number }                        // {x:%}
  | { f: 'sci'; digits?: number }                        // {x:sci}
  | { f: 'tex' }                                         // an Expr or Number as typeset math (inserts a math part)
  | { f: 'ord' };                                        // {n:ord}
```

`v` is what accessibility, search and `Text(…)` string operations use. For `math` parts, `v` carries the speech reading (section 8.1), not the raw source. `parts` exists only for texts that have live or math parts, so plain strings stay cheap.

Placement, style and rotation are **properties**, not values (kernel section 9): they are set with `with`, can be property rules, and never make a text recompute. The four commands that look like they change a text's presentation (`VerticalText`, `RotateText`) are conveniences that return a Text with the property set in its definition.

Properties of a Text object:

| Property | Values | Default |
|---|---|---|
| `at` | `(x, y)` world position; `screen(px, py)` pixels; an object name (anchor to that object) | the point given to the command |
| `anchor` | `nw n ne w c e sw s se` (which corner of the text sits at `at`) | `sw` for world, `nw` for screen |
| `align` | `left center right` for multi-line text | `left` |
| `size` | points | 16 |
| `bold`, `italic`, `serif` | Bool | false |
| `color`, `bg` (background), `border` | Color / none | text colour main; no background |
| `rotate` | angle (radians, `deg` suffix allowed) | 0 |
| `vertical` | Bool: stack the letters downward | false |
| `latex` | `subset` (default), `full`, `off` (treat `$` as a literal character) | `subset` |
| `width` | pixels (wrap) or `auto` | `auto` |
| `sizeIn` | `screen` (pixels; ignores zoom) or `world` (scales with the view) | `screen` |

### 2.2 Evaluating a text

A Text object is a rule whose inputs are the objects its parts refer to. When an input changes, the rule rebuilds the string from the parts: literals copied, `ref` parts formatted, `math` parts left as source (their layout is cached by source string). The text's value `v` is replaced; if `v` is unchanged (formatting hides a tiny change), the kernel's cut-off stops the update from going downstream and no repaint is requested.

- Cost target: a text with 3 live parts rebuilds in under 10 µs. 200 live texts: under 2 ms per frame.
- Undefined inputs: a `ref` to an undefined object prints a dash `–` in its place (and the text stays defined). The core design rule says undefined flows downstream; for text this would hide a whole sentence when one number is missing, so text is declared `acceptsUndefined`. If the sentence should vanish, the author writes `showif`.
- A `{name}` that refers to another Text object inserts that text's parts, so typeset pieces stay typeset (`{sx}` where `sx = SurdText(x)`).
- Escapes follow the language area: `\{`, `\}`, `\"`, `\\`, `\n`, plus `\$` for a literal dollar sign.
- Nesting: `{if(c, "yes", "no")}` and other expressions inside braces use the full expression grammar (the language area parses them).

### 2.3 Number formatting rules

One formatter is used everywhere (texts, readouts, CAS output, tooltips):

- `fixed n`: round to `n` decimals, **half away from zero, using the shortest decimal that identifies the double**, so `1.005` with `fixed 2` shows `1.01` (what a learner expects), not `1.00` (the exact binary value). Negative zero and `-0.00` show as `0.00`.
- `sig n`: the same rule, `n` significant digits, never switching to exponent notation unless the magnitude is outside 1e-6 … 1e9, then `1.23e-7`.
- `deg`: value times 180/pi, then `fixed` with the default 0 decimals (`{θ:deg}` → `30°`; `{θ:deg2}` is two decimals).
- `frac`: best rational (section 4.3), as a stacked fraction in math output or `3/4` in plain.
- `pct`: value times 100 with a percent sign.
- `sci`: mantissa and power of ten.
- `auto`: the figure's global rounding setting (default 4 significant digits for non-integers; integers up to 15 digits print in full).
- Grouping separators and decimal commas: phase 3 (locale). The formatter takes a `NumberLocale` object; v1 passes the English one.

---

## 3. How GeoGebra does it (plain words)

### Text objects

- A text object holds a string, a flag for "this is a formula in LaTeX", sizes and style flags, and a position that is either fixed on screen or a point in the construction (it can be attached to a point so it moves with it).
- **Dynamic text** is a text defined as an expression: literal strings joined with objects by the `+` sign, so the text changes when an object changes. The text tool's dialog has an "insert object" menu that builds this expression for the user. How a number appears in the text follows a global rounding setting unless a command applies a different one.
- LaTeX texts are rendered by a separate renderer that turns the formula into a bitmap or vector image, cached by string and size. A text is either all plain or all LaTeX: there is no mixing inside one text.
- Text objects can be rotated and shown vertically through commands.

### The commands

- A `Text` command turns any object into text, optionally at a point, and has flags: show values or names (substitute), treat as LaTeX, and horizontal and vertical alignment. A `LaTeX` command (and its sibling that produces a formula for the object) returns the LaTeX source of an object. A table command lays a list of lists out as a LaTeX array, with a small string language (letters for alignment, bars for lines, brackets) to control borders. Fraction, surd, scientific, ordinal and continued-fraction commands each format a number as text. The Unicode commands convert between text and lists of numbers. Replace and split work with regular expressions of the host language.
- The surd command searches a fixed table of candidates (small square roots, pi and its simple powers, e) and sums of a rational and a root of a small prime, accepting the first within a numeric tolerance, which is the global precision setting.

### Logic commands

- `If` is a command that returns one of two objects, can chain several conditions, and when its branches are functions makes a conditional (piecewise) function. `CountIf` and `KeepIf` take a condition written in terms of an implicit variable and a list. `IsDefined`, `IsInteger` and `IsInRegion` return Booleans. `Relation` compares two objects, answers with a short sentence, and offers a "more" button that runs a heavier geometric prover for some geometry cases.

### What works

- A familiar text tool; dynamic text by simple insertion; a LaTeX renderer people already know.

### What is weak

- Dynamic text is string concatenation, so number format and the text are tangled; mixing words and formulas in one text needs workarounds.
- LaTeX is all-or-nothing per text and the source string is opaque: errors show as a blank or red box without a position.
- Number rounding is global, not per use, in many commands.
- Regular expressions from the host language: a risk of catastrophic backtracking and different behaviour between platforms.
- Text commands that return strings force string handling for what are really structured values (a table, a fraction).
- `Relation` reports only what is true at this moment for numeric cases and sends the user to another tool for proof; it cannot say that a relation follows from the way the figure was built.

---

## 4. Text commands, in our syntax

Conventions: `x` is a Number or Expr, `T` a Text, `n` a whole number, named arguments as in the core design.

### 4.1 Making text

| Command | Forms | Returns | Notes |
|---|---|---|---|
| `Text` | `(obj)`; `(obj, at: Point)`; named `show = value\|definition`, `latex = Bool`, `anchor = …` | `Text` | Any object to text. `show = value` (default) prints the object's current value; `show = definition` prints how it was made (the line's right-hand side), so `Text(M, …)` with `show = definition` prints `Midpoint(A, B)`. |
| `LaTeX` | `(obj)` | `Text` | The LaTeX source of the object as plain text (no dollar signs), for display of the source itself (`Text(LaTeX(f), …)` shows `\frac{x^2}{2}`) or for copying. The result has `latex = off`. |
| `FormulaText` | `(obj)`, named `substitute = Bool` | `Text` | The object as a typeset formula (a text with one `math` part). With `substitute = true` the names inside a formula are replaced by their current values (`a x + b` with `a = 2` prints `2x + b`); otherwise names stay. |

What `obj` may be and how it prints:

| Object | Plain text (`Text`) | Formula (`FormulaText`, LaTeX) |
|---|---|---|
| Number | formatted by the figure's rounding, or by `fmt` | the same number |
| Bool | `true` / `false` | `\text{true}` |
| Point | `(1.5, 2)` | `\left(1.5, 2\right)` |
| Vector | `(1.5, 2)` | column vector `\begin{pmatrix} 1.5 \\ 2 \end{pmatrix}` |
| Line | `y = 2x + 1` or `a x + b y = c` normalised | the same, typeset |
| Circle | `(x - 1)² + (y - 2)² = 9` | typeset |
| Function | `f(x) = x² - 2` | `f(x) = x^{2} - 2` |
| Expr, Cond | the symbolic printer `toText` | `toLatex` |
| List | `[1, 2, 3]` | typeset list or matrix when a list of equal-length lists |
| Text | itself | `\text{…}` |
| Polygon | `Polygon(A, B, C)` | the vertices |

### 4.2 Number formats as text

| Command | Forms | Behaviour |
|---|---|---|
| `FractionText` | `(x)`, `(x, maxDen)`, named `tol` | Typeset fraction for the best rational approximation; integers print as integers; negative sign in front. See 4.3. |
| `SurdText` | `(x)`, `(x, tol)` | The simplest exact form that matches: see 4.4. |
| `ScientificText` | `(x, sig = 6)` | `$1.23 \times 10^{4}$` for 12300 at 3 digits. `x = 0` prints `0`. Not finite: undefined `not_finite`. |
| `Ordinal` | `(n)` | `1st`, `2nd`, `3rd`, `4th`, `11th`, `12th`, `13th`, `21st`, `101st`, `111th`. `n` a non-negative whole number; negative or non-integer: undefined `out_of_domain`. English only in v1. |
| `ContinuedFraction` | `(x)`, `(x, levels)`, `(x, levels, short: Bool)` | The continued fraction of `x` as nested fractions, or the compact bracket form `[a0; a1, a2, …]` when `short`. See 4.5. |

### 4.3 Best rational (FractionText, ContinuedFraction, `{x:f}`)

Continued-fraction expansion of `x` with the convergents `p_k/q_k`. Stop at the first convergent where `|x - p/q| <= tol × max(1, |x|)` (default `tol = 1e-9`) or when `q > maxDen` (default 1,000,000). For exact inputs (`Expr` rational), the exact fraction is returned. Float noise (such as 0.30000000000000004) is handled by the tolerance: the result is `3/10`. Accuracy statement: the result is the convergent with the smallest denominator within tolerance, which is also the best rational with that denominator bound among those found (by the theory of continued fractions, a convergent is a best approximation of its size). If the tolerance cannot be met within `maxDen`, undefined `no_convergence` with the best fraction in `detail`, so the teacher can say "about 355/113".

### 4.4 SurdText

For a Number input the output is a guess at an exact form, so it is labelled a **match** and carries the residual in the result's `meta`. For an exact Expr input it is exact.

Search, in order, accepting the first match within `tol` (default 1e-10 relative):

1. A rational `p/q` (section 4.3 with `maxDen = 10^4`).
2. A rational multiple of a known constant: `pi`, `1/pi`, `pi^2`, `sqrt(pi)`, `e`, `sqrt(e)`, `e·pi`, and `ln 2`, `ln 10`.
3. `a sqrt(b) / c`: test whether `x²` is a rational `u/v` with small `u`, `v`; then simplify the square root by taking out square factors.
4. `(p + q sqrt(r)) / s` for squarefree `r` up to 200: an integer-relation search on `(1, sqrt(r), x)` with coefficients bounded by 10^4, done by lattice reduction in exact arithmetic (a three-dimensional reduction; small and fast) on 40-digit values of `sqrt(r)` and `x`.
5. Nested radicals `sqrt(a + b sqrt(c))` when the radicand is a perfect square in `Q(sqrt(c))` (denest).
6. None: print the decimal and set `meta.match = false`.

A match is accepted only if the residual is below `tol` **and** the integers involved are small (the sum of absolute coefficients under 10^4), which keeps false positives out (a random double matches some large-integer relation always). The teacher is told to say "looks like" when `exact` is false.

### 4.5 ContinuedFraction details

- Exact rational input: the exact finite expansion.
- Quadratic irrational (an `Expr` like `sqrt(2)` or `(1 + sqrt(5))/2`): the periodic expansion via the standard exact algorithm on `(P + sqrt(D))/Q`, with the period marked by an overline in the typeset form (`[1; \overline{2}]`) and `levels` limiting how many terms print before the overline summary.
- Other numbers: expand until `levels` terms, or until the next partial quotient would be unreliable (when the residual error of the float input exceeds the remaining precision, at about 15 digits), and flag `meta.truncated`.
- Default `levels`: 5.

### 4.6 TableText

| Form | Meaning |
|---|---|
| `TableText(rows)` | `rows` is a `List<List<…>>`; each cell may be a Number, Text, Expr, Bool or a Text with math |
| `TableText(rows, align = "lcr")` | One letter per column: `l` left, `c` centre, `r` right, `.` align at the decimal point; shorter strings repeat their last letter |
| `TableText(rows, header = true)` | First row is a header (bold, rule below) |
| `TableText(rows, border = none\|all\|outer\|rows\|cols)` | Lines |
| `TableText(rows, brackets = none\|paren\|square\|brace\|bar)` | Matrix-like brackets |
| `TableText(rows, fmt = "2")` | One format for every number cell, or a list of formats per column |
| `TableText(cols, byColumns = true)` | Each inner list is a column |

Returns a Text whose value carries a `TableSpec` (rows, columns, cell parts, alignment, lines). The layout engine draws it as an array of boxes. Cells that are live (`ref` parts) update individually. Unequal row lengths: padded with empty cells and the notice `ragged_table`. Cap: 10,000 cells (`limit`).

### 4.7 VerticalText and RotateText

- `VerticalText(T)` returns a Text with `vertical = true` (letters stacked top to bottom, each upright).
- `RotateText(T, angle)` returns a Text with `rotate = angle` about its anchor point. `angle` in radians; the `deg` suffix works.
- Both accept a Text only (use `Text(obj)` first for other objects).

### 4.8 String tools

| Command | Forms | Behaviour |
|---|---|---|
| `ReplaceAll` | `(T, old: Text, new: Text)` | Plain replacement of every non-overlapping occurrence, left to right. Case-sensitive. No pattern language in v1 (section 4.9). |
| `Split` | `(T, sep: Text)` | `List<Text>`. `sep` is a literal string. Empty `sep` splits into characters (code points). Consecutive separators give empty strings; a trailing separator gives a final empty string. Max 100,000 pieces. |
| `LetterToUnicode` | `(T)` | The code point of the first character, as Number. Empty text: undefined `empty_list`. |
| `TextToUnicode` | `(T)` | `List<Number>` of code points (not UTF-16 units). |
| `UnicodeToText` | `(L: List<Number>)` | Text from code points. |
| `UnicodeToLetter` | `(n)` | One-character Text. |

Code points are whole numbers from 0 to 1,114,111 excluding the surrogate range 55,296 to 57,343 and (for safety in figure files) excluding control characters other than tab and newline; otherwise undefined `out_of_domain` with the index. Combining sequences and emoji with joiners are several code points; the commands are honest about that (they work on code points, not on user-perceived characters).

The length and indexing of a Text (`len(T)`, `T[i]`, `Take`) belong to the language area; when they count characters they count code points, consistently with these commands.

### 4.9 Why no regular expressions (yet)

The browser's regular expression engine can take exponential time on some patterns. A model or a learner can write such a pattern by accident, and a frame would freeze. Phase 2 adds `ReplaceAll(T, old, new, regex = true)` and `Split(T, sep, regex = true)` backed by a small linear-time matcher that we write (supporting classes, groups, alternation, greedy and lazy repeats, no back-references), so the cost is bounded by `|pattern| × |text|`. Until then, plain strings cover the common uses (replace a word, split on a comma).

---

## 5. Logic commands, in our syntax

### 5.1 Operators and `if`

The core design already has `and`, `or`, `not`, `==`, `!=`, `<` …, and `if(c, a, b)`. Additions:

- `xor(a, b)` and `implies(a, b)` as lower-case built-ins on Bools (the language area lists `implies` as an operator).
- `if(c, a, b)` evaluates `c` first, then only the chosen branch; the other branch is not evaluated, so an undefined value or a division by zero there does nothing.
- `cases(c1, v1, c2, v2, …, otherwise)` is the multi-branch form: the first true condition wins; `otherwise` is required. All values must have the same type (or all be Numbers or Functions).
- Branches that are Functions: `f(x) = if(x < 0, -x, x)` and `g(x) = cases(x < -1, x + 2, x <= 1, 1, 3 - x)` create a **piecewise function**. It is a Function whose compiled body has the conditions; the plotter splits at breakpoints; the symbolic layer holds it as a `piecewise` node. Conditions on `x` only: comparisons of `x` with expressions, joined with `and`, `or`.
- No two-branch `if(c, a)` without an else: write `if(c, a, undefined)`; the literal `undefined` makes the cell undefined with reason `not_set`.

### 5.2 Counting and filtering

| Command | Forms | Returns |
|---|---|---|
| `CountIf` | `(L: List<T>, k, cond)` where `k` is a new bound name valid inside `cond` | Number (count) |
| `KeepIf` | `(L: List<T>, k, cond)` | `List<T>`: the items for which `cond` is true, in order |

Same binding rule as `Map(list, k, expr)` in the core design. An item for which `cond` is undefined is not counted and not kept, and the notice `skipped_undefined` lists how many.

### 5.3 Tests

| Command | Forms | Returns | Notes |
|---|---|---|---|
| `IsInteger` | `(x: Number)`, `(e: Expr)` | `Bool` | Numbers: true when `|x - round(x)| <= 1e-12 × max(1, |x|)`; for `|x| >= 2^53` every double is an integer, so true. Exprs: decided exactly (rational with denominator 1). Not finite: false. |
| `IsDefined` | `(obj)` | `Bool` | True when the object's cell is defined. This is one of the rules declared `acceptsUndefined` in the kernel. `IsDefined(a)` is false when `a` is undefined for any reason, including inherited ones. |
| `UndefinedReason` | `(obj)` | `Text` | The reason in plain words ("the lines are parallel", "x is outside the domain of ln"), or empty text if defined. Also `acceptsUndefined`. |
| `IsInRegion` | `(P: Point, region)` where `region` is Polygon, Circle, Region, or (phase 2) a `Cond` in `x, y` | `Bool` | Boundary counts as inside (within `1e-9 × scale`). Polygons use the winding number (works for non-convex and for polygons given in either orientation); a self-crossing polygon uses the even-odd rule, and the notice `self_crossing` says so. A `Region` (between curves, under a function) is tested by the interval of `x` and the values of the bounding functions. |

### 5.4 Relation and Related

```text
Relation(a, b) -> Text
Related(a, b, kind: Text) -> Bool
```

`Relation(a, b)` gives a short factual sentence. `Related(a, b, "parallel")` answers yes or no for one named relation. Kinds are a closed set: `equal`, `distinct`, `parallel`, `perpendicular`, `coincident`, `intersecting`, `on`, `inside`, `outside`, `tangent`, `secant`, `disjoint`, `concentric`, `nested`, `less`, `greater`, `congruent`. An unknown kind is an error listing the kinds that apply to that pair of types.

**Which relations are checked for which pairs**

| Pair | Relations (the sentence picks the one that is true) |
|---|---|
| Number, Number | equal; less; greater (with the difference) |
| Point, Point | equal; distinct (with the distance) |
| Point, Line / Ray / Segment | on; not on (distance); for a segment: between the ends or beyond |
| Point, Circle | on; inside; outside (distance to circle) |
| Point, Polygon | inside; on boundary; outside |
| Line, Line (also Ray, Segment as lines) | coincident; parallel; perpendicular; intersecting (at a point, with the angle) |
| Segment, Segment | equal length; also the line relations |
| Line, Circle | secant (two points); tangent (one point); apart (distance) |
| Circle, Circle | coincident; concentric; tangent externally; tangent internally; intersecting (two points); nested; disjoint |
| Polygon, Polygon | equal area; congruent (phase 2) |
| Anything else | undefined `unsupported` with `detail` listing the supported pairs |

**Tolerance**: all numeric tests use `1e-9 × scale`, where `scale` is the larger of 1 and the largest absolute coordinate of the objects involved. Every sentence says "now" or "always" (below). Values that differ by less than the tolerance are reported as equal; the sentence includes "(to within 1e-9)" only when the difference is nonzero but under the tolerance.

**Always versus now.** Each relation result carries `basis`:

- `by_construction`: the relation follows from how the objects were made. Examples: `l2 = Parallel(P, l1)` makes `l2` parallel to `l1` for every position of the free objects. `M = Midpoint(A, B)` is on `Segment(A, B)` and equidistant from `A` and `B`. `m = Perpendicular(P, l)` is perpendicular to `l`.
- `now`: true at the current positions, found numerically, not guaranteed when something is dragged.
- `no`: not true now (and not by construction).

The knowledge behind `by_construction` is data in the command table, not a prover: each command may declare what its output guarantees as a small list of facts about its inputs and output:

```ts
interface Guarantee {
  readonly kind: RelationKind;
  readonly a: 'out' | number;      // 'out' = the result, number = input position
  readonly b: 'out' | number;
}
// e.g. Parallel(P, l): [{ kind: 'parallel', a: 'out', b: 1 }, { kind: 'on', a: 0, b: 'out' }]
```

At query time a small closure is computed over the guarantees along the two objects' dependency chains: parallel and perpendicular compose (two lines parallel to a third are parallel; parallel to a perpendicular is perpendicular), equal-length and "on" are transitive in the obvious ways, a copy by `Translate`, `Rotate` or `Reflect` preserves length, angle and parallelism, etc. The closure is limited to the relations in the table above and a depth of 8 steps. It never claims a relation it cannot derive from guarantees; when the relation holds numerically but no chain proves it, `basis` is `now`.

The result sentence, built from templates, for example:

- "l1 and l2 are parallel, and stay parallel however the figure is dragged (l2 was built parallel to l1)."
- "l1 and l2 are perpendicular right now (the angle is 90.0000°), but nothing in the figure keeps them so."
- "A is 3.2 from the circle, outside it."
- "c1 and c2 are tangent from the outside at one point."

`Related(a, b, kind)` returns `true` for `by_construction` and `now`. `Related(a, b, kind, always = true)` returns `true` only for `by_construction`.

---

## 6. The math layout engine

All typeset maths in the product (text `$…$`, `FormulaText`, `TableText`, CAS output, readouts, tooltips) is drawn by one engine, `packages/view/math`, given a **box tree**. It lives in the view package and needs only the graphics interface (core section 8): `path`, `fill`, `text`, `transform`, so it draws to canvas and to SVG export with no extra work.

### 6.1 Box tree

```ts
type MBox =
  | { b: 'glyph'; ch: string; font: 'math' | 'text' | 'bold' | 'italic' | 'mono'; size: number }
  | { b: 'row'; items: readonly MBox[] }
  | { b: 'frac'; num: MBox; den: MBox; rule?: boolean }
  | { b: 'sup' | 'sub'; base: MBox; script: MBox }
  | { b: 'supsub'; base: MBox; sup: MBox; sub: MBox }
  | { b: 'root'; body: MBox; index?: MBox }
  | { b: 'fence'; open: string; close: string; body: MBox }          // auto-sized
  | { b: 'bigop'; op: string; lower?: MBox; upper?: MBox; limits: 'above' | 'side' }
  | { b: 'matrix'; rows: readonly (readonly MBox[])[]; align: readonly ('l' | 'c' | 'r')[]; lines?: Lines }
  | { b: 'accent'; kind: 'hat' | 'bar' | 'vec' | 'dot' | 'tilde'; body: MBox }
  | { b: 'overline' | 'underline'; body: MBox }
  | { b: 'space'; em: number }
  | { b: 'text'; s: string; style: 'normal' | 'bold' | 'italic' };
```

Layout (measure, then place) yields a tree with width, ascent and descent for each box. The algorithm follows the long-published rules for typesetting maths (cramped and uncramped styles, script size steps, fraction numerator and denominator shifts, radical clearance, operator limits), with all constants read from the **font's OpenType MATH table** rather than hard-coded, so changing the math font changes the layout correctly. Sizes: text style 100 %, script 70 %, script-script 50 %.

### 6.2 Where boxes come from

Three producers, all ending in the same tree:

1. The **symbolic printer** (`toBoxes(node)`) builds boxes directly from a `SymNode`: no LaTeX string in between, so CAS output costs nothing to parse and cannot fail to parse.
2. The **LaTeX-subset parser** (`parseTex(src)`) builds boxes from a `$…$` source or `FormulaText` string authored by a person or a model.
3. **Table and text layout** (`TableText`, wrapped paragraphs) combine boxes with text boxes.

### 6.3 The LaTeX subset (phase 1)

| Group | Supported |
|---|---|
| Structure | `{…}` groups, `^`, `_` (with groups), `\frac`, `\dfrac`, `\tfrac`, `\sqrt`, `\sqrt[n]{}`, `\left … \right` with `( ) [ ] \{ \} | \langle \rangle .`, `\over` is not supported |
| Big operators | `\sum \prod \int \oint \lim \max \min \sup \inf` with limits, `\bigcup \bigcap` |
| Letters | Greek lower and upper (`\alpha … \omega`, `\Gamma \Delta \Theta \Lambda \Pi \Sigma \Phi \Psi \Omega`), variants `\varepsilon \varphi \vartheta`, Hebrew `\aleph` |
| Relations | `= \ne \neq < > \le \leq \ge \geq \approx \sim \simeq \equiv \cong \propto \parallel \perp \in \notin \subset \subseteq \supset \supseteq \to \rightarrow \Rightarrow \Leftrightarrow \mapsto` |
| Operators | `+ - \pm \mp \times \div \cdot \ast \circ \cap \cup \wedge \vee \neg \forall \exists \nabla \partial \infty \ldots \cdots \vdots \ddots` |
| Functions | `\sin \cos \tan \cot \sec \csc \arcsin \arccos \arctan \sinh \cosh \tanh \ln \log \exp \det \gcd \deg \dim` (upright, with thin space) |
| Accents | `\hat \bar \vec \dot \ddot \tilde \overline \underline \overrightarrow` |
| Text and fonts | `\text{}`, `\mathrm{}`, `\mathbf{}`, `\mathit{}`, `\mathbb{R}` (R, N, Z, Q, C only), `\mathcal{}` (letters A to Z) |
| Arrays | `\begin{matrix|pmatrix|bmatrix|vmatrix|cases|array|aligned}` with `\\` and `&` |
| Spacing | `\, \; \: \! \quad \qquad ~` |
| Colour | `\color{name}{…}` with the figure's named colours |
| Escapes | `\% \$ \& \# \_ \{ \}` |

Anything else gives the error `latex_unsupported` with the macro name, its position inside the source, and (for common macros we know about but skip, like `\tikz`) the hint that `latex = full` is available in phase 2.

### 6.4 Full LaTeX fallback (phase 2)

A text with `latex = full` is rendered by an embedded KaTeX (MIT licence, licence file read) into a DOM overlay positioned over the canvas. It is exact for the full KaTeX macro set. Limits, stated plainly: not drawn into SVG export or exported images (the export shows a placeholder box with the plain text), not hit-tested by the canvas (the overlay handles pointer events), and loaded lazily (about 280 KB). Alternative: MathJax with SVG output (Apache-2.0, licence read) would allow export but is several times larger. We choose KaTeX for the fallback and keep the subset engine as the default because of export, size and speed.

### 6.5 Fonts

A single math font with an OpenType MATH table is bundled as WOFF2 (candidates with open licences: STIX Two Math, Latin Modern Math, Noto Sans Math; the final pick is made on licence file review and size before the build step), about 250 KB subset to the glyphs used by the subset, plus the figure's UI font for ordinary text. Glyph metrics are read once at load into a typed array table. Fallback if the font fails to load: system serif for letters and a built-in table of bar/radical drawing for the structures, with a notice in the console (not in the lesson).

### 6.6 Caching and speed

- Layout cache: key `(source or node id, size, style)`, value the placed box tree and a pre-built draw path list. 2,000 entries.
- Measure and place: under 0.3 ms for a typical formula (30 boxes), under 2 ms for a 3 by 3 matrix of fractions.
- Draw: glyphs are drawn with `fillText` batches; rules (fraction bars, radical tops) as rectangles. A formula repaint is under 0.2 ms.
- Live parts (`ref`) inside a `math` part rebuild the box tree only when the number's printed form changes.

---

## 7. How text plugs into the kernel and the view

- `Text` is a type in the core design. This area adds the `parts` and `table` fields to the value and the properties in 2.1. Property rules (`at = P`, `rotate = θ`) are standard.
- The command table entries in section 4 and 5 are ordinary `CommandSpec`s; `Text`, `FormulaText`, `TableText`, and `Relation` are `acceptsUndefined` where needed (a Text with an undefined `ref` still renders).
- **Drawable**: one `TextDrawable` per Text: computes the box tree (from parts), the bounding rectangle (used for hit-testing and for anchoring), and a draw list. Dirty when `v`, a style property, or the view scale changes (the font size is in screen pixels, so zoom does not scale it, unless `size` is given in world units with `sizeIn = world`).
- **Anchoring to an object**: `at = A` places the anchor at the object's screen position; the offset (in pixels) is kept as a property so a text moves with its point without being rewritten.
- **Selection and editing**: double-click opens the text editor (section 1 of `ui.md`); the editor works on the `parts` array, so inserted objects stay references.
- **Labels**: object labels and captions use the same engine: a caption is a Text part list evaluated with the object in scope (`%v` style shortcuts are not adopted; use `{name}` references).
- **Export**: SVG export draws text as `<text>` elements for plain strings and as paths for `math` parts (glyph outlines via the font's path data) so the file looks the same without our font installed.

---

## 8. Accessibility and other languages

### 8.1 Screen readers

Each Text object contributes `aria-label` from `v`. A `math` part's contribution is its speech reading, produced by `toSpeech` on the box tree's source structure (for symbolic output, from the `SymNode`; for LaTeX source, from the parse tree). Reading rules: fractions "x over y" (short) or "the fraction with numerator … and denominator …" (long, over 12 characters); powers "x squared", "x cubed", "x to the n"; roots "the square root of …", "the n-th root of …"; fences "open parenthesis" only when they change the reading. Tables read row by row with column headers when `header = true`.

### 8.2 Languages

Phase 3: a `Locale` object supplies number separators, ordinal rules, and the words in `Relation` sentences. Sentence templates are keyed (`relation.parallel.always`) so translation is table work, and the teacher can ask for the sentence in the lesson language. v1 ships English only; all text produced by commands goes through the template table so adding a language does not touch the command code.

---

## 9. Better than GeoGebra

1. **Words and maths in one text.** `Text("The area is $\frac{1}{2} b h$ = {A:2}", …)` mixes plain words, a typeset formula and a live number; no all-or-nothing LaTeX switch.
2. **Number format per use.** `{x:3sf}`, `{θ:deg}`, `{p:%}`, not a single global rounding; formatting rule matches what learners expect (`1.005` → `1.01`).
3. **Structured, not stringly.** `Text` keeps parts, so live pieces update individually and `TableText` cells are real values.
4. **Errors with positions.** A bad LaTeX macro reports which macro and where.
5. **Safe text tools.** No regex backtracking hazard; code points not code units.
6. **Always versus now.** `Relation` says whether a relation is built into the figure; the teacher can promise "this stays true when you drag."
7. **One layout engine for everything**, driven by a font's own maths constants, exportable to SVG, with no external renderer for the common cases.
8. **Piecewise functions are first-class** through `if` and `cases`, known to the plotter and the symbolic layer.
9. **Undefined can be asked and explained**: `IsDefined`, `UndefinedReason`.
10. **Deterministic helpers**: `Split`, `ReplaceAll` are total and defined for empty inputs.

---

## 10. Edge cases

- A `ref` to an object that was deleted: the kernel's delete cascades; a text part cannot dangle (deleting the object deletes the text or, if the author chooses `Delete(obj, keepText = true)` in a later phase, replaces the part by its last value as a literal).
- A very long text (over 20,000 characters): `limit`. Over 2,000 characters renders without wrap unless `width` is set.
- A text with `$` characters that are not math: `\$` or `latex = off`.
- Unbalanced `$`: the text is a plain string up to the unbalanced one, the error `unbalanced_math` is returned with its position.
- `{x:2}` where `x` is a Point: formats both coordinates with the same format.
- `{x:deg}` where `x` is not an angle (just a number): it is converted anyway, as the author asked (no unit tracking in v1).
- `FractionText(0.5, 1)` with `maxDen = 1`: `no_convergence` with the nearest integer in `detail`.
- `SurdText(pi)`: matches the known-constant list: `\pi`.
- `Ordinal(0)`: `0th`.
- `Split("", ",")`: a list with one empty text.
- `IsInRegion` with a degenerate polygon (fewer than 3 distinct vertices): undefined `degenerate`.
- `Relation` on undefined inputs: the cell is undefined with `input_undefined` (normal rule).
- `KeepIf` on an empty list: empty list.
- Mixed types in `cases`: `type_mismatch` with the two branches named.
- A conditional function whose conditions overlap: first wins (documented), the notice `overlapping_cases` appears if the plotter detects the overlap numerically.

---

## 11. Changes to the core design

1. **Section 4 Text**: the value gains `parts` and an optional `table`; properties in 2.1 (`at`, `anchor`, `align`, `size`, `bold`, `italic`, `serif`, `bg`, `border`, `rotate`, `vertical`, `latex`, `width`) are added to the property list (kernel section 9). Reason: the core design says "Text may contain `{expr}` that updates and `$…$` maths" without a model.
2. **Format list** in the language area's text interpolation: add `sci`, `tex`, `ord`, `%` with digits, `deg` with digits. (`d` in the language design is the same as our `deg`.) Reason: the formats this area uses.
3. **Built-ins**: add `xor`, `implies` (if not already) and the multi-branch `cases(…)`; require an explicit else in `if`. Reason: logic area and piecewise functions.
4. **`acceptsUndefined` set**: add `IsDefined`, `UndefinedReason`, and Text as a value type (undefined parts print a dash).
5. **Command rule metadata**: optional `guarantees` list on a `CommandForm` (section 5.4) for `Relation`. Reason: "always versus now".
6. **Undefined reasons**: none added. `if` requires an explicit else, so no "condition false" reason is needed.
7. **Errors added** (kinds in `errors.md`): `latex_unsupported`, `unbalanced_math`, `bad_format`, `bad_relation_kind`, `bad_align`, `bad_code_point` (undefined reason `out_of_domain` at run time), `text_too_long`.
8. **Open question 3 of the core design** (LaTeX in texts): answered by this design: yes from phase 1, as a subset with a box layout engine; full LaTeX is an optional lazy fallback.

---

## 12. Acceptance tests

1. **Layout golden tests**: 300 formulas (fractions, nested roots, scripts, matrices, big operators) lay out to box trees whose widths and heights match hand-checked values within 0.5 px at 16 px; and the SVG exports render identically on two machines.
2. **Round trip**: for generated `SymNode`s, `parseTex(toLatex(n))` produces the same box tree as `toBoxes(n)`.
3. **Format tests**: `fixed`, `sig`, `deg`, `frac`, `pct`, `sci` against a table of 500 inputs including ties (`0.5`, `1.005`, `2.675`), negatives, tiny and huge values, `-0`.
4. **FractionText**: 10,000 random fractions with denominators up to 1,000 are recovered from their double values.
5. **SurdText**: 2,000 constructed surds are recognised; 2,000 random doubles are not falsely matched (false positive rate under 1 in 10,000).
6. **Strings**: `Split`/`ReplaceAll` against a reference on empty and edge inputs; code point round trips for random Unicode including astral characters.
7. **IsInRegion**: against a brute-force oracle for random polygons (convex, concave, with holes not supported), points on edges and vertices.
8. **Relation**: 200 constructions with known facts; every `by_construction` claim holds after 100 random drags; every `now` claim is false after at least one of the drags for relations that are not guaranteed.
9. **Frame time**: 200 live texts update under 2 ms; a 3 by 3 matrix of fractions repaints under 0.3 ms.
10. **Accessibility**: speech strings reviewed against a list of 100 formulas.

---

## 13. Open questions

1. Which math font ships (licence and size review needed before the build)?
2. Should `Text` allow Markdown-like bold/italic runs in v1, or only whole-text bold/italic properties?
3. Should the percent literal `5%` exist in the language (affects the financial and text formats)?
4. How far should `Relation`'s closure go before it becomes a prover? Current limit: the relation table and depth 8.
5. Should `Text` on an object in `show = definition` mode print our syntax or a localised name?

---

## Sources studied

GeoGebra source (read only, commit 3608374), under `source/shared/common/src/main/java/org/geogebra/common/`:

- `kernel/geos/` (text object, its properties, inline text; text style interfaces)
- `kernel/algos/` (dependent text, text, table text, fraction text, text-to-unicode and back, text length, text corner, list and logic algorithms)
- `kernel/cas/` (surd text, simplify text)
- `kernel/commands/` (command groups: text, logical; command filters)
- `euclidian/draw/` (text and LaTeX rendering classes, alignment helpers)
- `kernel/arithmetic/` (text expressions; skimmed)

Manual pages (not readable in the fetch tool; behaviour taken from the source and command tables): https://geogebra.github.io/docs/manual/en/commands/ groups "Text Commands" and "Logic Commands", and the Text tool page.

Licence checks: https://github.com/KaTeX/KaTeX (MIT, licence file read); https://github.com/mathjax/MathJax-src (Apache-2.0, licence file read).
