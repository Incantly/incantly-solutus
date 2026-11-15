# Text and logic: requirements

Area: `docs/features/text-logic/` (`design.md`, `errors.md`, `agent.md`, `ui.md`). Branch: `feat/text-logic`.

Already built by the language area: text literals with live parts `{expr}` and `{expr:fmt}`, `$…$` kept in the text,
`if(c1, v1, …, otherwise)` with any number of arms (README decision 13, which replaces `cases`), `and or not xor`,
and `Relation(a, b)`.

### R1. Number formats in text (design 2.3)

1. THE SYSTEM SHALL accept the language's formats (`2`, `.3`, `d`, `f`, `%`) and the design's names: `3sf`
   (significant figures), `deg` and `degN`, `frac`, `pct` and `pctN`, `sci` and `sciN`, `ord`.
2. Fixed decimals SHALL round half away from zero on the shortest decimal of the number, so `{1.005:2}` is `1.01`,
   and SHALL never print `-0.00`.

### R2. Making text (design 4.1)

1. `Text(obj)` SHALL print the object's value; `Text(obj, show = "definition")` its definition's right-hand side.
2. `LaTeX(obj)` SHALL give the LaTeX source of the object (its definition for a named object, else its value).
3. `FormulaText(obj)` SHALL give a text with one math part `$…$`; `substitute = true` puts current values in place of
   the names the definition reads.

### R3. Number formats as text (design 4.2 to 4.5)

1. `FractionText(x)`, `(x, maxDen)`: best rational by continued fractions, `tol` 1e-9; `no_convergence` when the
   tolerance is not met within `maxDen`.
2. `SurdText(x)`: rational, rational multiple of a known constant, `a√b/c`, `(p + q√r)/s` for squarefree `r ≤ 200`,
   else the decimal. Small integers only.
3. `ScientificText(x, sig)`, `Ordinal(n)` (English), `ContinuedFraction(x, levels, short)`.

### R4. Tables, rotation and string tools (design 4.6 to 4.8)

1. `TableText(rows)` with `align`, `header`, `brackets`: a math part with an array; ragged rows padded with the notice
   `ragged_table`; at most 10,000 cells.
2. `ReplaceAll`, `Split`, `LetterToUnicode`, `TextToUnicode`, `UnicodeToText`, `UnicodeToLetter` on code points;
   surrogates and control characters (other than tab and newline) are `out_of_domain`.

### R5. Logic (design 5.1 to 5.4)

1. `implies(a, b)` as a built-in on Bools.
2. `CountIf(L, k, cond)` and `KeepIf(L, k, cond)`: an item whose condition is undefined is skipped, with the notice
   `skipped_undefined`.
3. `IsInteger`, `IsDefined`, `UndefinedReason` (the last two accept undefined inputs), `IsInRegion(P, Polygon|Circle)`
   with the boundary inside and the even-odd rule for a self-crossing polygon (notice `self_crossing`).
4. `Related(a, b, kind)` for the pairs of design 5.4 (numerically, "now"); an unknown kind is an error listing the kinds.

### R6. The math layout engine and drawn text (design 6 and 7), second round

1. A box tree from the LaTeX subset, drawn by the view through the graphics interface (canvas and SVG).
2. Text objects drawn in the studio at `at`, with `anchor`, `size`, `color`, `bg`, `rotate`, `vertical`.

### R7. Tests and speed

1. Spec tests for R1 to R5; a text with 3 live parts rebuilds in under 10 µs.
