# Language area: doc edits (review category C)

Branch `feat/language`. Doc editor pass; no code, tests or `review.md` touched. "L" = `docs/features/language/`.

## Review items

| # | Status | Where it changed |
|---|---|---|
| C1 | done | L `design.md` 1.2, 3.5, 3.6, 3.9; L `agent.md` 5.4; L `errors.md` 2, 3, 4 (`m * (x - A.x)`, `(1/2) * x`, `k * x`, `pi * r^2`). `agent.md` 5.1 already read `m * (x - A.x)` |
| C2 | done | `bad_character`, `limit`, `arg_count` in L `design.md` 3.1, 3.2, 3.14, 3.19 and L `errors.md` 2, 5, 7; `bad_char`, `too_long`, `too_deep`, `bad_arity` removed (the colon label row is now `syntax`) |
| C3 | done | L `errors.md` 1 (unified `ErrorObject`, `suggest`, `related` as names, `path`, `code`, `phase`, `committed`, `recovery` added to every example); L `design.md` 3.13 (`Notice`, kind `clamped`), 3.15 and 4 (`cause`); algebra-view docs use `clamped` and `cause`. `cause` text depends on the code rename A2 |
| C4 | done | L `design.md` 3.14 constants row for `inf`; numeric-behaviour bullet |
| C5 | done | L `design.md` 3.8 row now `h(x) = f(g(x))`, plus the free-variable note |
| C6 | done | L `design.md` 3.9 (row and paragraph: Circle only when `r2` works out to a number; slider radius gives a conic `Curve`; use `Circle(O, a)`); L `agent.md` card |
| C7 | partly | `Ty` objects and `tyStr` text in L `design.md` 3.10, 3.16, 3.17 and L `agent.md` 3; `ParamSpec.type` is text; `matchForms`, `CheckCtx`, `infer` marked internal. The `Function2` decision is not added: A3 is not settled (see below) |
| C8 | done | L `design.md` 3.10 operator table; L `agent.md` operator line (list on the left only) |
| C9 | done | L `design.md` 3.14: only `min` and `max` take a list; `abs(L)` is `no_matching_form`; `sum`, `mean` are not built-ins |
| C10 | done | L `design.md` 3.14 speed target, per function per redraw (2,000 samples, 20 nodes, under 0.2 ms) |
| C11 | done | L `errors.md` 7: nodes, list literal and text are backstops for built values |
| C12 | done | `docs/design/performance.md` section 1: language rows and measured values |
| C13 | done | L `agent.md` card: `th = state(0.5)` before `th' = -g` |
| C14 | done | L `errors.md` 1: `draw` is independent lines, `applyBatch` is atomic |
| C15 | done | L `design.md` 3.1: no figure needed; `isTaken`, `isObjectCommand`, `tokenize(source, fig)` are naming and colouring hooks |
| C16 | done | L `errors.md` 2 `bad_number` row; `docs/features/errors/errors.md` L003 row (`1e`, `0x` removed) |
| C17 | done | L `design.md` 3.12 step 4 (direct readers are enough); 3.17 and 3.18 (token scan plus normal parser, known gaps of B12) |

## Rulings carried

Q1, Q2 (L `design.md` 3.5, 3.6; `errors.md` 3, 4), Q3 (3.5 logic on undefined), Q4 (`inf` rows), Q5, Q6, Q7 (3.11 step 6; `errors.md` 5), Q8, Q9 (3.9; `errors.md` 3 example, col 9 to 10), Q10, Q11 (3.3; `errors.md` 2, 4), Q12, Q13, Q14 (`errors.md` 1), depth 64/65, finite slider bounds, SM-23 and Q-R4-1 (3.12 step 2). Design 3.5 now has the "comparisons with an infinity" rule (known bug 3 after round 5).

`cause` names the nearest undefined input and following the links reaches the root: L `design.md` 3.15, L `errors.md`, `docs/features/kernel/design.md` (struct comment, text near the cell type, summary item 4), `docs/features/kernel/errors.md`, `docs/features/README.md` decision 2.

## Invalid examples fixed in other areas

Name-name or `)`-name products, or the `Line`/`Solve` forms copied from the language docs:
`docs/design/formula-language-and-kernel.md` (Line from `a*x + b*y == c`); algebra-view `agent.md`, `ui.md`; animation-time `agent.md`, `design.md` (pendulum, projectile, wave, particle spray, `-e * v`); app-modes `agent.md`; cas `agent.md`, `design.md`, `errors.md` (inputs to `Solve`, `Expr`); conics `agent.md`; curves-loci `agent.md`, `design.md` (`sin(x*y)`, and `==` for the equation); embed-files-export `design.md`; functions-calculus `design.md`; space-3d `agent.md`, `design.md`. algebra-view also uses `cause` and `clamped`.

## Left for a decision

1. **A3 `Function2`.** Add to L `design.md` 3.10 once the type decision is made (make `Function<Number>(2)` satisfy `Function2`, or drop `Function2` from README decision 5).
2. **`docs/state-machines.md`** still says `via` (Env, `FunctionValue`). Rename to `cause` when the A2 code change lands.
3. **CAS result display.** `cas/agent.md` (`draw` returns `fp = (x - 2)(x - 3)`) and `cas/design.md` (`2 pi k1`, `(x - sqrt(2))(x + sqrt(2))`, `a + b i`) print products by juxtaposition. Not changed: is printed `Expr` text meant to be re-enterable as a line? If yes, print with `*`.
4. **`docs/features/numbers-sliders/errors.md` line 44.** `a b = 3` is listed as `syntax` "Unexpected 'b'". Under design 3.6 two adjacent names are `missing_operator`.
5. **Infix `mod`.** `cas/agent.md`/`text-logic/agent.md` (`KeepIf(L, k, k mod 2 == 0)`) and `formula-language-and-kernel.md` (`(t + life * rand(i)) mod life`) use `mod` as an operator; the language has only `mod(a, b)`.
6. **Circle radius that reads a plain number object.** The code gives a conic `Curve` for any `r2` that depends on an object (a slider and a free number alike). The docs say "depends on an object". Confirm this is intended for a non-slider free number.
7. **Math notation not changed.** Juxtaposition in derivations and formulas (conics, statistics, polygons-transforms, optimisation-discrete, RK4 steps in animation-time, text-logic LaTeX) is mathematics, not input lines.
