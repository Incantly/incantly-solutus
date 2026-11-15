# Symbolic: checker findings

Checker pass 1 (pipeline step 4) at commit `3266a74` on `feat/symbolic`. Paths are under `packages/symbolic/src/` unless given in full; line numbers refer to `3266a74`. State machines S1 to S10 are in `docs/state-machines.md`, section `symbolic`.

Each finding was reproduced through the public entry (`packages/symbolic/src/index.ts`) from throwaway vitest files under `packages/symbolic/test/probe/`, deleted afterwards. "Run" below means `run(op, args, opts, ctx)`; `ex(s)` is `{ k: 'expr', e: parseExpression(s), exact: true }` and `cd(s)` the same for `parseCondition`. Times are from Node 26 on an Apple M1 Pro. At this commit `npx vitest run` passes.

Ranked by impact: security, then hangs and crashes, then wrong results, then wrong errors, then speed, then cosmetic. Fix groups are listed at the end.

## Security

### SYM-SM-1: Parsing an untrusted text takes time exponential in its `if` nesting, before any budget

- **Impact:** security (denial of service on the main thread from one short line typed by a learner or sent by the model).
- **Evidence:** `parse.ts` `parseCondOrExpr` (line 442) parses each `if` argument as a full condition first; when no comparison follows, it rewinds and parses the same argument again as an expression. A nested `if` in an argument is therefore parsed twice per level. `run('Expr', [{ k: 'text', v }], { fastLaneMs: 2 })` with `v` built as `s = if(x < k, s, 2)` repeated: 12 levels 62 ms, 16 levels 957 ms, 18 levels 3,778 ms (doubling per level; 30 levels would take hours). `Expr` is not a heavy op, so it runs on the main thread, and the text is parsed in `opExpr` (`ops.ts` line 258) outside any `Budget`. `Steps` parses its call text the same way (`run.ts` `argTextToSym` → `parseExprOrCond`) before its inner budget starts. The 500-level depth cap (`parsePrimary`) does not help: 30 levels are far below it.
- **Invariant broken:** S9: parse time is linear in the text. S1: no work runs outside a budget.
- **Suggested fix:** decide condition versus expression without re-parsing: parse an expression once, then look at the next token (a comparison, `in`, `and`, `or`) to continue as a condition, as `parseTop` already does; or memoise `parseOr` failures by token position. Put a token-count cap on parser input (the language uses 800 tokens per line) and charge parsing to the run budget.
- **status:** fixed
- **fix:** Conditions and expressions are parsed in one pass with no re-parse; a text may have at most 100,000 tokens.

### SYM-SM-2: `rootof` in parsed text isolates roots with no budget

- **Impact:** security (main-thread hang of minutes from one line); also an `internal` error.
- **Evidence:** `parse.ts` `callNode`, `rootof` branch (lines 510 to 518): `treeToUPoly(args[0], symN('x'))` and `upolyIsolate(p)` run with the default `NO_TICK` ticker (`poly.ts` line 16), so the Sturm sequence and bisection are unbounded. `run('Expr', [{ k: 'text', v: 'rootof((x+1)^1000 - 2, 1)' }], { fastLaneMs: 2, limits: { maxMs: 50 } })` returned after 215,073 ms with 369 MB of heap. At degree 300 (`rootof((x+1)^300 - 2, 1)`) the same call ends in `internal` "Cannot mix BigInt and other types, use explicit conversions" after 3 ms. Other `NO_TICK` defaults: every `poly.ts` export takes `tick: Ticker = NO_TICK`, and `refineRootFloat`/`refineRootRational` take no ticker at all (called from `solve.ts` lines 329 and 1736 and `ops.ts` line 1478).
- **Invariant broken:** S2: every loop whose length depends on the input ticks.
- **Suggested fix:** make the ticker a required parameter in `poly.ts` (no default), pass one into the parser (or cap the degree a `rootof` literal may have, for example the 200 of `maxFactorDegree`), and give the two refiners a ticker. Check every caller of a `poly.ts` function for the same rule.
- **status:** fixed
- **fix:** The rootof branch passes the run's ticker to the polynomial routines and caps the degree. The polynomial multiply no longer adds past the end of its result when one operand is much shorter than the other, which was the degree-300 internal error.

### SYM-SM-3: The digit and node limits are never enforced; one `Factor` line exhausts memory

- **Impact:** security (process abort from out-of-memory: in production this kills the CAS worker); slow folding in the cheap ops.
- **Evidence:**
  - `DEFAULT_LIMITS.maxNodes` (200,000) and `maxDigits` (100,000) are read nowhere (`grep maxNodes\|maxDigits` finds only `contracts.ts`), and `Budget.tick` never throws `'nodes'` or `'digits'` (`run.ts` lines 52 to 72).
  - `run('Factor', [ex('x^2 - (10^1000)^99')], { limits: { maxMs: 50 } })` aborted the Node process: `node::OOMErrorHandler … v8::Utils::ReportOOMFailure`. The constant has 99,001 digits, under the 100,000-digit fold guard, so it is an integer; `upolyRationalRoots` then asks `intDivisors` (`poly.ts` lines 235 to 256) for all divisors of `10^99000`, about 9.8e9 of them, as one array.
  - `intPowNumber` (`node.ts` lines 590 to 611) checks the digit count of the partial result `r` but squares the base `b` first (line 605): for an exponent with one high bit, `b` reaches the full power before the check. `run('Expr', [{ k: 'text', v: '(10^100)^65536' }], { fastLaneMs: 2 })` spends 821 ms in the constructor (result left as a power); `(10^1000)^65536` builds a 65-million-digit integer first.
  - `roots.exact` (`rules.ts` line 382) computes `p ** whole` with no size check, where `whole` comes from the exponent: `2^(2000000001/2)` asks for `2 ** 1000000000`.
  - `ratPow` in `treeToUPoly` (`poly.ts` line 770) raises the numerator and denominator to exponents up to 100,000 with no digit check.
- **Invariant broken:** S2: `maxNodes` and `maxDigits` are enforced; design 5.5 ("more than 100,000 digits is `limit`") and 5.13.
- **Suggested fix:** one helper that predicts the digit count before a power, a product of big integers or a divisor enumeration (`bitLength(base) * exponent`, product of `(e + 1)` over the factorisation) and throws `BudgetExceeded('digits')`; use it in `intPowNumber` (check `b` too), `roots.exact`, `ratPow`, `mulNumbers`, `intDivisors` and `divisorsFromFactors`. Count interned nodes per run against `maxNodes`. Apply the rule to every value kind that holds integers (int, rat, dec mantissa, polynomial coefficients).
- **status:** fixed
- **note:** Fixed on `feat/cas`: digit guards before `ratPow`, `upolyPow` (coefficient bound), `roots.exact` powers and products; divisor lists charged to the run before they are built; each trial division of a long number is a step. `Factor(x^2 - (10^1000)^99)` now ends as `timeout` in about 80 ms. Tests: `packages/symbolic/test/spec/budgets.test.ts`.

### SYM-SM-4: Loops that ignore the run budget

- **Impact:** security (each case runs for seconds to minutes, or exhausts memory, regardless of `maxMs` and `maxSteps`).
- **Evidence:**
  - `roots.pull` (`rules.ts` lines 123 to 156) trial-divides up to 1,000,000 with no `tick`, and runs once per pass per candidate in `Simplify`. `Simplify` of the sum of `sqrt(k * 1000000000039)` for k = 2 to 41 took 1,821 ms with `maxMs: 1000` (about 25 ms per term per pass; the 20,000-node input cap allows thousands of terms). `roots.exact` (line 367) does the same to 100,000.
  - Whole-number ops take no ticker (`ops.ts` lines 1928 to 2039, `num.ts`): `IsPrime(2^4423 - 1)` took 2,143 ms and `NextPrime(10^600)` 1,001 ms, both with `maxMs: 50`; `checkPrimeDigits` allows 6,000 digits, about four times larger. `primeFactorsBig` has its own 2,000,000-step budget, separate from the run's (641 ms with `maxMs: 50`).
  - `Divisors`, `DivisorsList` and `DivisorsSum` build the whole divisor list (`num.ts` `divisorsFromFactors`, line 220), also for the count and the sum: the product of the first 21 primes (2^21 divisors) took 845 ms with `maxMs: 50, maxSteps: 1000`; 30 primes is 2^30 BigInts.
  - `binomialBig` (exported as `binomialExact` for the optimisation area) loops `k` times with no cap.
  - `runSteps` re-enters `run` with `ctx` only (`run.ts` line 558), so `opts.limits` given to `Steps` are dropped and the inner command always gets the default budget.
- **Invariant broken:** S2 and S6: every input-sized loop ticks; the inner command of `Steps` runs with the caller's limits.
- **Suggested fix:** give `roots.pull`, `roots.exact` and every `num.ts` loop the run's ticker (Miller-Rabin: one tick per squaring); compute the divisor count and sum from the factorisation without listing, and cap `DivisorsList` by the predicted count; pass `opts.limits` into the `Steps` inner call.
- **status:** fixed
- **note:** Fixed on `feat/cas`: `roots.pull` and `roots.exact` tick per trial; `primeFactorsBig` charges the run's ticker, weighted by the size of the number; `binomialBig` ticks and refuses k past 10^6 (`binomialExact` returns undefined). Every evidence case now stops within twice its `maxMs`. Tests: `budgets.test.ts`.

### SYM-SM-5: Untrusted names read `Object.prototype` members

- **Impact:** security (text from a model or a learner calls `Object.prototype` functions as commands); a cache entry with no cell; LaTeX output with JavaScript source text.
- **Evidence:**
  - `runSteps` looks the command up with `OPS[call.op]` on a plain object (`run.ts` line 549, `ops.ts` line 2108). `run('Steps', [{ k: 'text', v: 'constructor(x)' }])`, `toString(x)` and `valueOf()` pass the `undefined` check, run `Object.prototype` functions as ops, `cachePut` stores `{ cell: undefined }` (`run.ts` line 452), and the call ends in `internal` "out.notices is not iterable". `run('constructor', [ex('x')])` ends in `internal` "Cannot read properties of undefined (reading 'defined')".
  - `print.ts` `latexName` (line 317) does `greek[name] ?? name` on a plain object: `toLatex(symN('constructor'))` is `function Object() { [native code] }` and `toLatex(symN('toString'))` is `function toString() { [native code] }`.
- **Invariant broken:** S1: `op` names only an entry of the command table; registries answer only their own keys (the same rule as LANG-SM-1).
- **Suggested fix:** `Object.hasOwn(OPS, op)` in `runSteps` and at the top of `runInner`; `Object.hasOwn(greek, name)` in `latexName` (or `Map`s). Search the package for every other plain-object lookup keyed by text (`SYMBOLIC_ERROR_CODES[e.kind]`, `CORE_ERROR_CODES`, `OP_PHASES`, the `flip` tables) and do the same.
- **status:** fixed
- **fix:** Command and name tables are looked up with own-key checks or Maps.

## Hangs and crashes

### SYM-SM-6: Root isolation breaks on large coefficients

- **Impact:** crash reported as `internal`; also a wrong `[]` from `Solve`.
- **Evidence:** `poly.ts` `cauchyBound` (line 531) divides coefficients converted with `Number(...)`; a coefficient above about 1.8e308 gives `Infinity`, and `upolyIsolate` (line 557) calls `BigInt(Math.floor(-B))`. `run('NSolve', [cd('x^3 - x - 10^400 == 0'), ex('x')])` ends in `internal` "The number -Infinity cannot be converted to a BigInt because it is not an integer". `run('Solve', [cd('x^3 - x - 10^400 == 0'), ex('x')])` returns `[]` after 992 ms, though every real cubic has a real root (about 4.6e133). The degree-300 `rootof` in SYM-SM-2 ends in another `internal` error inside the same code.
- **Invariant broken:** S10: no real solution is missed; `run` maps every failure to a reason.
- **Suggested fix:** compute the root bound in BigInt (for example `1 + max |c_i| / |c_n|` rounded up, or a power of two from bit lengths), never through `Number`; keep the interval arithmetic exact throughout. Add `limit` for coefficients past the digit budget (SYM-SM-3).
- **status:** fixed
- **fix:** The root bound is computed in whole numbers, never through a double.

### SYM-SM-7: The node arena only grows, and `arena.clear()` corrupts the engine

- **Impact:** memory grows for the whole session (a crash in a long lesson); a public call that breaks every later result.
- **Evidence:** `node.ts` lines 154 to 187: the arena is a `Map` that never drops a node; design 5.13 says it is rebuilt from live nodes past 1,000,000. 3,000 calls of `run('Expand', [ex('(x + i)^12')])` with `clearCache()` between them left `arena.size()` at 525,628 nodes and 169 MB of heap. `arena.clear()` (exported, described as "Rebuild drops unreachable nodes") empties the map and restarts ids at 1 while `ZERO`, `ONE`, `MINUS_ONE`, `TWO`, `HALF` and every cache entry keep the old objects and ids: after `arena.clear(); clearCache()`, `run('Solve', [x^2 - 4 == 0, x])` returns `[]`.
- **Invariant broken:** S4: one object per structure; constants are arena members; ids are unique for the life of every cache entry; the arena is rebuilt past 1,000,000 nodes.
- **Suggested fix:** replace `clear()` by a rebuild that keeps the constants and every node reachable from the cache (or clears the cache with it and re-interns the constants first); trigger it from `run` when the size passes the threshold. Use a weak structure if the target engines allow it.
- **status:** fixed
- **fix:** arena.clear() is a rebuild that keeps the base constants and tells the run cache to forget what it held; ids are never reused; the arena is rebuilt past 1,000,000 nodes at the start of a top-level run.

## Wrong results

### SYM-SM-8: Arguments that crossed to the worker are not interned, so heavy ops answer wrongly

- **Impact:** wrong results for every heavy command run the documented way (design 5.13: heavy ops run in the worker).
- **Evidence:** `worker.ts` lines 1 to 6 state that `SymNode`s "cross `postMessage` by structured clone unchanged". They do not stay interned: the clone is a new object graph, so the engine's identity tests (`t === gen` in `treeToUPoly`, `x === ONE`, `a.arg !== b.arg`) fail, and in a real worker the cloned `id` fields name unrelated nodes of the worker's own arena, which the id-keyed memo maps (`mapNodes`, `nodeCount`, `freeSymbols`) and the cache key (`argKey`, `e${id}`) then confuse. In one process: `handleWorkerRequest(structuredClone({ id: 1, op: 'Solve', args: [cd('x^2 - 1 == 0'), ex('x')] }), run)` returns `[]`; the same call on the original objects returns `[x == -1, x == 1]`.
- **Invariant broken:** S7: a job's arguments mean the same in the worker as on the main thread. S4: `===` is structural equality.
- **Suggested fix:** re-intern every argument on arrival (`handleWorkerRequest` rebuilds each tree bottom-up through the smart constructors, or through a raw `intern` that keeps the canonical shape) and re-intern results on the host side; better, send a compact serial form (`toText` once SYM-SM-19 is fixed, or a node table) instead of the object graph. Never trust `id` across realms.
- **status:** fixed
- **fix:** Every argument is re-interned on arrival, so a structured clone means the same in the worker.

### SYM-SM-9: The run cache key misses inputs, so one call's answer is served to another

- **Impact:** wrong results that depend on call order: assumptions leak from one `Assume` into a different one, a notice leaks, a degraded result is served to full-budget calls.
- **Evidence:** `run.ts` `argKey` (lines 88 to 102) and `cacheKey` (lines 104 to 108).
  - A Cond is keyed by `condText`, which joins `and`/`or` parts and `not` with no brackets (`print.ts` lines 438 to 440). `run('Assume', [(a < 0 or b > 0) and a > 0, ex('sqrt(a^2)')])` is `a`; then `run('Assume', [a < 0 or (b > 0 and a > 0), ex('sqrt(a^2)')])` returns the cached `a`; after `clearCache()` the second call gives `abs(a)`. The facts in the key (line 106) use the same text. A Cond's `exact` flag is not in the key either.
  - An Expr is keyed by node id and `exact` only, not `excluded` or `display`. `Equivalent(Simplify((x^2-1)/(x-1)) result, x + 1)` gives notice `differ_at`; then `Equivalent` of the same tree without `excluded` returns the cached notice; fresh, it gives none.
  - `limits` are not in the key: `run('Simplify', [ex('(x^2 - 1)/(x - 1)')], { limits: { maxSteps: 40 } })` caches `(x^2 - 1)/(x - 1)` (see SYM-SM-10), and the next default call returns it instead of `x + 1`.
  - A `dec` key ignores `prec` through `condText`.
- **Invariant broken:** S1: the key covers every input that can change the output; S5: no assumption outlives its call.
- **Suggested fix:** key Conds and facts structurally (a bracketed form, or the interned ids of every node plus the condition shape, as `node.ts` `condKey` does); add `exact`, `excluded`, `display` and the effective limits to the key; or do not cache calls whose limits differ from the defaults.
- **status:** fixed
- **fix:** The cache key is structural for conditions and facts and includes exact, excluded, display and the effective limits.

### SYM-SM-10: `Simplify` turns a budget stop into a defined, unsimplified answer

- **Impact:** wrong result (a `timeout` reported as a value), nondeterministic output, and through SYM-SM-9 a degraded answer kept in the cache.
- **Evidence:** `rules.ts` `tryCandidate` (lines 1392 to 1398) and the final `togetherNode` (line 1446) catch every exception, `BudgetExceeded` included. Once the step budget is spent, `Budget.tick` throws on every call, so every remaining candidate fails and `simplifyNode` returns the current form. `run('Simplify', [ex('(x^2 - 1)/(x - 1)')], { limits: { maxSteps: 40 } })` is the defined value `(x^2 - 1)/(x - 1)` with no excluded values, not `timeout`. With the `ms` budget the cut depends on machine speed, so the same line gives different results on different machines (design acceptance 9). The same catch also hides internal errors (a `TypeError` or a stack overflow) inside a candidate. `Assume`, `IsZero`, `Equivalent` and the solver call `simplifyNode` and inherit this.
- **Invariant broken:** S3: a budget stop ends the call as `timeout`; the result does not depend on wall time.
- **Suggested fix:** rethrow `BudgetExceeded` from `tryCandidate` and the final `try`; catch only `LimitExceeded` and `Unsupported` there. If the design wants "a candidate that blows the budget is dropped", give each candidate its own step sub-budget (deterministic), never the shared wall-clock one.
- **status:** fixed
- **fix:** A candidate is dropped only for Unsupported, LimitExceeded or NonElementary; a spent budget ends the call as timeout and an internal fault is reported.

### SYM-SM-11: `sin(pi/24)` is 0 and `cos(pi/24)` is 1

- **Impact:** wrong exact values, also inside every result that folds them.
- **Evidence:** `node.ts` `exactTrigValue`, line 772, sends denominator 24 to `reduceTrig12`, which computes `r = (n mod 2d) * 12 / d` in BigInt division: for d = 24 and odd n the fraction truncates (`1 * 12 / 24 = 0`). `run('Simplify', [ex('sin(pi/24)')])` is `0`; `run('Evaluate', [ex('cos(pi/24)')])` is `1` (cos goes through `sin(13 pi/24)`, `r = 6`, `ONE`). Every odd multiple of `pi/24` is affected (`sin(5 pi/24)`, `cos(7 pi/24)`, `tan(pi/24)`, …).
- **Invariant broken:** design 5.5: exact trig values only from the table of known values; a fold is exact.
- **Suggested fix:** call `reduceTrig12` only for d = 12 (and 6, 4, 3, 2 after reduction); leave 24 unfolded, or add a correct table for multiples of `pi/24`. Check `reduceTrig10` and the `/8` table the same way (they are exact for their denominators).
- **status:** fixed
- **fix:** Exact trig values are folded only for the denominators the tables cover; multiples of pi/24 are left unfolded.

### SYM-SM-12: Zero tests use a float tolerance, so nonzero numbers are "proved" zero

- **Impact:** wrong `true` from `IsZero` and `Equivalent` (documented: `true` only when proved), and wrong "every value works" from `Solve`.
- **Evidence:** `equiv.ts` `zeroVerdict` line 49: a symbol-free difference is `true` when its float value is below `1e-12`. `run('IsZero', [ex('exp(-50)')])` is `true`; `run('IsZero', [ex('x - x + 1/10^20')])` is `true` although `1/10^20` is an exact nonzero rational. `solve.ts` line 463 does the same for an equation without the unknown: `Solve(exp(-30) == 0, x)` is "all". Large values fail the other way: `Math.sqrt(1e40 + 1) - 1e20` is 0, so `IsZero(sqrt(10^40 + 1) - 10^20)` is `true`.
- **Invariant broken:** design 2.2: `Equivalent` and `IsZero` are `true` only when proved; S10: "all" or "none" for a constant equation is decided exactly.
- **Suggested fix:** decide exactly when the difference is an exact rational (`asRational`); for closed real constants evaluate with interval or decimal arithmetic at growing precision (the `toDecimal` path) and answer `false` when the interval excludes 0, `unknown` otherwise. Never answer `true` from a float.
- **status:** fixed
- **fix:** A constant with no symbols is zero only when simplification or an exact rational proves it; it is non-zero when a float is clearly away from zero or when 80- and 160-digit evaluations agree on a non-zero value; otherwise the answer is unknown. The same decision is used for an equation without the unknown.

### SYM-SM-13: `Solve(eq and rel)` keeps a solution that sits on a strict bound

- **Impact:** wrong solutions.
- **Evidence:** `ops.ts` `solveOneCond`, `and` branch, line 1101: `if (isZeroNode(sub)) return true` keeps a solution whenever the substituted difference is exactly 0, whatever the relation. `Solve(x^2 == 4 and x < 2, x)` is `[x == -2, x == 2]`; `Solve(x^2 == 4 and x != 2, x)` is `[x == -2, x == 2]`. Both should be `[x == -2]`. The float fallback (`holdsRel`, line 1118) also treats `<=` and `>=` with a `1e-9` tolerance, which keeps solutions just outside a bound.
- **Invariant broken:** S10: every solution satisfies every side condition.
- **Suggested fix:** when the difference is exactly 0, return `op` in `{==, <=, >=}`; when it is an exact rational use its sign; otherwise use an exact or interval sign test and mark the solution `denominator_unchecked` when undecidable, not a tolerance.
- **status:** fixed
- **fix:** A solution exactly on a bound is kept only for ==, <= and >=; an exact rational difference uses its sign.

### SYM-SM-14: Definite integrals and limits step over poles

- **Impact:** wrong values for divergent integrals and limits that do not exist; a wrong `divergent` for an integrable singularity.
- **Evidence:**
  - `run('Integral', [ex('tan(x)'), ex('x'), { k: 'num', v: 0 }, { k: 'num', v: 2 }])` is `-ln(abs(cos(2))) + ln(abs(cos(0)))`; `tan` has a non-integrable pole at `pi/2` inside [0, 2], so the answer is `divergent` (design 5.10: use the antiderivative only if it is continuous on [a, b]).
  - `run('Limit', [ex('tan(x)'), ex('x'), ex('pi/2')])` is the defined value `tan(1.5707963267948966)`, a float substituted into the function; the left and right limits are `inf` and `-inf`, so the answer is `no_limit`.
  - `run('Integral', [ex('1/sqrt(abs(x))'), ex('x'), { k: 'num', v: -1 }, { k: 'num', v: 1 }])` is `divergent` "singular near 0"; the integral converges to 4 (design 5.10: an integrable pole is handled as an improper integral).
- **Invariant broken:** design 5.10; the definite-integral and limit results equal the mathematical value or are undefined with the right reason.
- **Suggested fix:** find poles of the integrand and of the antiderivative on [a, b] exactly (zeros of denominators, of `cos` under `tan`, of log arguments) before using the antiderivative; split the interval at each and take one-sided limits. In `limitNode`, test continuity at the point exactly (the argument `pi/2` is a pole of `tan`) instead of substituting a float.
- **status:** to be implemented
- **note:** Partly fixed: a limit at an exact pole of tan, 1/cos or 1/sin is decided from the two sides, and a definite integral over such a pole is divergent. Still to do: an integrable singularity such as 1/sqrt(abs(x)) on [-1, 1] is still reported divergent. Owner: symbolic.

### SYM-SM-15: `floor`, `ceil` and `round` of exact numbers go through a double

- **Impact:** wrong (inexact) result from exact input.
- **Evidence:** `node.ts` `foldFn` line 644 converts the argument with `toFloat` and folds with `Math.floor`; above 2^53 the result is `floatN`. `run('Evaluate', [ex('floor(10^20/3)')])` is `33333333333333330000` (a float); the exact value is `33333333333333333333`. Rationals whose double rounds across an integer fold wrongly even below 2^53 (for example `floor((10^17 - 1)/10^17)` folds through `1.0`).
- **Invariant broken:** design 5.4 and 8: exact input stays exact; exactness never returns or is lost by rounding.
- **Suggested fix:** for `int` and `rat` use BigInt floor division (`n / d` with sign correction) for `floor`, `ceil` and `round` (with the kernel's rounding convention); keep the float path for `float` and `dec` only.
- **status:** fixed
- **fix:** floor, ceil and round of whole numbers and rationals use whole-number division.

### SYM-SM-16: Parametric case splits list impossible cases and miss real ones

- **Impact:** wrong solution sets for equations with parameters.
- **Evidence:** `run('Solve', [cd('x^2 == a'), ex('x')])` is `[x == sqrt(4 * a)/2, x == -sqrt(4 * a)/2]` with `cases` `1 == 0 and 0 != 0`, `1 == 0 and 0 == 0 and -a == 0`, `1 == 0 and 0 == 0 and -a != 0`: the cases split on the numeric leading coefficient 1, and there is no `a < 0` case although for `a < 0` there is no real solution. `Solve(a*x^2 + b*x + c == 0, x)` has no case for `b^2 - 4 a c < 0`. `Solve(a*x == 0, x)` lists `a == 0 and 0 != 0`, which can never hold, and `a == 0 and 0 == 0` instead of `a == 0`. `Solve(ln(x) == 1, x)` lists `1 == 0 and -e == 0`.
- **Invariant broken:** S10: a case split lists only possible parameter values, and every value where the generic answer fails (design 2.3, 5.9 step 5).
- **Suggested fix:** split only on coefficients that contain a parameter; simplify each case condition and drop the ones that are `false`; in real mode, add the sign condition of the radicand (`a >= 0`, discriminant `>= 0`) to the generic answer and the complementary `none` case.
- **status:** to be implemented
- **note:** Not fixed in this round. Owner: symbolic.

### SYM-SM-17: `Factor` stops early, and multivariate results carry a junk content

- **Impact:** wrong or misleading factorisations.
- **Evidence:** `run('Factor', [ex('x^12 - 1')])` is `(x - 1) * (x + 1) * (x^10 + x^8 + x^6 + x^4 + x^2 + 1)` with no `irreducible` notice, but `x^10 + … + 1` factors further as `(x^2 + 1)(x^2 - x + 1)(x^2 + x + 1)(x^4 - x^2 + 1)` (design acceptance 3: `Factor` recovers the planted factors). `Factor(x^2 - y^2)` is `-36 * (x/36 + y/36) * (y - x)`; `Factor(x^2 + 2*x*y + y^2 - z^2)` is `-166839735777662410596 * (z^2/166839735777662410596 - x^2/166839735777662410596 - …)`, unfactored and with a 21-digit constant (the expected answer is `(x + y - z) * (x + y + z)`). The values are equal to the input; the forms are not factorisations. `Factor(x^3 + y^3)` is left whole.
- **Invariant broken:** design 5.8 steps 3 and 4: content extracted, every factor irreducible, the sign in front; acceptance 3.
- **Suggested fix:** recurse `upolyFactor` on the `irreducible` pieces that `kroneckerFactor` left (or implement the documented Cantor-Zassenhaus and Hensel path); in `mpolyFactor`, take the integer content and the primitive part before the Kronecker image, map factors back to primitive integer polynomials, and reject a result whose `verifyFactor` ratio is not ±1 times the content.
- **status:** to be implemented
- **note:** Not fixed in this round. Owner: symbolic.

### SYM-SM-18: The parser accepts a `rootof` that names no root

- **Impact:** wrong numbers (`0`) from an invalid value.
- **Evidence:** `parse.ts` lines 510 to 518: `ivs[idx - 1]` may be `undefined` (index 0, negative, or above the number of real roots), and the node is built with hint 0. `run('Numeric', [ex('rootof(x^2 + 1, 1)'), { k: 'int', v: 20n }])` is `0`; `run('ToNumber', [ex('rootof(x^2 - 2, 5)')])` is `0`.
- **Invariant broken:** S9: `rootof(p, k)` names an existing real root.
- **Suggested fix:** throw `ParseFailure` (`bad_argument`) when `k < 1` or `k > ivs.length`; also require a square-free polynomial, as `upolyIsolate` assumes.
- **status:** fixed
- **fix:** rootof with an index below 1 or above the number of real roots, or with a repeated factor, is a parse error.

### SYM-SM-19: Printed text does not always parse back to the same value

- **Impact:** results that are not re-enterable as lines (design 5.11 round-trip property, acceptance 1); a model copying a result gets an error or a different value.
- **Evidence:**
  - Implicit multiplication after a number literal (`parse.ts` line 284) takes the keywords `and`, `or` and `in` as factors: `parseCondition('x > 0 and y < 1')`, `'x < 1 or x > 2'`, `'x == 1 and y == 2'` and `'(x < 1 or x > 2)'` all fail ("Unexpected text" or "Expected )"). The `cases` that `Solve(a*x == b, x)` returns print as `a == 0 and -b == 0`, which does not parse.
  - `condText` prints `and(or(A, B), C)` and `or(A, and(B, C))` as the same text, and `not(and(A, B))` as `not A and B`, which parses as `(not A) and B`.
  - A float node prints with `String(v)` (`print.ts`), and the parser turns a short decimal into an exact rational (`numNode`): `toText(floatN(0.5))` is `0.5`, which parses as `1/2`, so an inexact `NSolutions` answer re-enters as exact. `NaN` and `Infinity` print as names and parse as symbols.
  - The lexer reads `1.2.3` as one number token; `Number` makes it `NaN`, a float node, instead of a syntax error. `1e999` becomes a float `Infinity`.
- **Invariant broken:** S9: every printed text parses back to the same node; keywords are never operands; a number literal is finite.
- **Suggested fix:** in `parseProduct`, do not multiply implicitly by the names `and`, `or`, `not`, `in`; in `parseTop`, continue with `parseAnd`/`parseOr` after a comparison; bracket `or` inside `and` and anything compound under `not` in `condText` (and in `condLatex`/`condSpeech`); print floats in a form the parser keeps inexact, or document `Numeric`-style output as display-only; reject a second `.` and non-finite literals in `lex`/`numNode`.
- **status:** to be implemented
- **note:** Partly fixed: keywords are not implicit factors; and, or and not print with brackets and parse back; a second decimal point and a non-finite literal are refused. Still to do: a float prints as text that parses back as an exact rational. Owner: symbolic.

### SYM-SM-20: LaTeX output uses commands that do not exist

- **Impact:** typeset display fails (KaTeX reports an undefined control sequence) for common functions.
- **Evidence:** `print.ts` line 305 prints every function as `\name`: `toLatex(asin(x))` is `\asin\left(x\right)`, and the same for `\acos`, `\atan`, `\atan2`, `\asinh`, `\acosh`, `\atanh`, `\abs`, `\sign`, `\floor`, `\ceil`, `\round`, `\cbrt`, `\log10`, `\log2`. Only `sin`, `cos`, `tan`, `sinh`, `cosh`, `tanh`, `ln`, `min`, `max` are LaTeX operators.
- **Invariant broken:** design 5.11: `toLatex` is for typeset display.
- **Suggested fix:** a table from function name to LaTeX: `\arcsin`, `\arccos`, `\arctan`, `\left|…\right|` for `abs`, `\lfloor…\rfloor`, `\lceil…\rceil`, `\sqrt[3]{…}`, `\log_{10}`, `\log_{2}`, and `\operatorname{…}` for the rest.
- **status:** fixed
- **fix:** Functions print through a table of real LaTeX commands; any other name uses \\operatorname.

### SYM-SM-21: Family parameter names depend on earlier calls

- **Impact:** the same line gives different results depending on history; nondeterminism across worker restarts; the parameter is not an integer symbol.
- **Evidence:** `solve.ts` line 882: `trigParamNext` is module state, incremented at lines 817, 945, 988 and 2269. After `clearCache()`: `Solve(sin(x) == 1/2, x)` uses `k1`, `Solve(tan(x) == 1, x)` then uses `k2`, and the first call repeated after another `clearCache()` uses `k3`; `Steps(Solve(sin(x) == 1/2, x))` gave `k4`. The cache hides this until it evicts the entry. The symbol is a plain `sym` with no `integer` domain, although design 2.3 calls it "an integer Symbol created for the result".
- **Invariant broken:** S8: a result does not depend on calls made before it (design 5.12, acceptance 9).
- **Suggested fix:** number family parameters per result (start at `k1` in each call, skipping names already free in the input), and return the parameter with domain `integer` (for example in the result's `cases` or a `params` field the kernel turns into a `Symbol`).
- **status:** to be implemented
- **note:** Partly fixed: family parameters are numbered from k1 in every top-level call. Still to do: skipping names already free in the input, and returning the parameter with the integer domain. Owner: symbolic.

### SYM-SM-22: `GCD(0, 0)` is 1

- **Impact:** wrong result; disagrees with `ExtendedGCD(0, 0)`, which returns `[0, 1, 0]`.
- **Evidence:** `node.ts` `bigGcd` line 346 returns `1n` when both inputs are 0 (to protect `ratN`); `ops.ts` `gcdBig` uses it, so `run('GCD', [{ k: 'int', v: 0n }, { k: 'int', v: 0n }])` is 1. The list form `GCD([0, 0])` follows.
- **Invariant broken:** gcd(0, 0) = 0 by the usual convention and by `ExtendedGCD`.
- **Suggested fix:** a `gcdWhole` that returns 0 for (0, 0) in the whole-number ops; keep the guard only where a denominator is built.
- **status:** fixed
- **fix:** GCD(0, 0) is 0 in the whole-number commands.

### SYM-SM-23: `a sin + b cos` forms turn exact input into floats

- **Impact:** inexact answers where an exact one exists.
- **Evidence:** `rules.ts` `combineLinearTrig` (lines 973 to 1004) and `solve.ts` `solveTrigLinearCombo` build `floatN(Math.hypot(a, b))` and `floatN(Math.atan2(b, a))`. `run('TrigCombine', [ex('sin(x) + cos(x)')])` is `1.4142135623730951 * sin(x + 0.7853981633974483)` (exact: `sqrt(2) * sin(x + pi/4)`); `Solve(sin(x) == cos(x), x)` is `[x == 2 * pi * k4 + 0.7853981633974483, …]` (exact: `pi/4 + pi * k`). The cells are marked inexact, so the flag is honest, but design 5.9 lists `a sin + b cos as one sine` among the exact methods.
- **Invariant broken:** design 5.4: exact input gives an exact result where one exists.
- **Suggested fix:** compute `R = sqrt(a^2 + b^2)` with the constructors and `phi` with the exact inverse-trig fold (`atan(b/a)` folds for the school ratios), falling back to floats only when `a` or `b` is inexact.
- **status:** to be implemented
- **note:** Partly fixed: TrigCombine with exact rational coefficients gives an exact amplitude and phase. Still to do: solveTrigLinearCombo in the solver still builds floats. Owner: symbolic.

## Wrong errors

### SYM-SM-24: `Solve(ln(x) == 0, x)` is `unsupported` while `ln(x) == 1` solves

- **Impact:** wrong error for a textbook equation (answer `x == 1`).
- **Evidence:** `solve.ts` `isolateLog` line 861 requires `f` to be a sum of exactly two terms; with a right side of 0 the difference is `ln(x)` alone, so the method returns `null` and the call ends `unsupported` "No exact method for an equation with a logarithmic term". `Solve(ln(x) == 1, x)` and `ln(x) == 2` solve, and so does `exp(x) - 1 == 0`.
- **Invariant broken:** design 5.9: exponential and logarithmic equations with the unknown in one place are isolated and inverted.
- **Suggested fix:** treat a single term as `term == 0` (rest = 0) in `isolateLog`, and check the other isolation helpers for the same two-term assumption.
- **status:** fixed
- **fix:** A single logarithmic term is solved as term == 0.

## Speed

### SYM-SM-25: `Factor` of the degree-6 bench polynomial misses its target by 17 times

- **Impact:** speed (design 5.13 target: `Factor` of a degree-6 integer polynomial under 5 ms).
- **Evidence:** `packages/symbolic/bench/cas.bench.ts` at this commit: `Factor degree-6 polynomial: 84.985 ms/call` (target 5 ms) for `x^6 - 2*x^5 - 3*x^4 + 8*x^3 + 3*x^2 - 8*x + 4`, which comes back irreducible; the fixer's breakdown (`fixer-notes.md`) puts the time in the factor search (parse about 0.1 ms). `Solve quadratic with symbolic coefficients: 3.084 ms/call` (target 3 ms) is also over. Every other bench case passes.
- **Invariant broken:** design 5.6 and 5.13 targets.
- **Suggested fix:** the documented modular method (factor modulo a small prime, Hensel lift, bounded recombination) replaces the Kronecker search; a cheap irreducibility test modulo two or three primes catches this input in microseconds.
- **status:** to be implemented
- **note:** Not fixed in this round; the bench was not run again. Owner: symbolic.

### SYM-SM-26: The two lanes never meet: heavy ops are always `pending`, and the worker cannot be cancelled

- **Impact:** speed (every heavy cell takes a worker round trip on every evaluation, so cached answers never show in the same frame); runaway jobs cannot be stopped.
- **Evidence:** `run.ts` lines 418 to 425: with `fastLaneMs`, a heavy op returns the main-thread cache entry or `pending`, and never tries a fast finish: `run('Simplify', [ex('x')], { fastLaneMs: 2 })` is `pending`. Heavy results are computed only in the worker, whose module instance has its own cache, and nothing in the API (`cachePut` is private, `WorkerResponse` carries no key) puts them into the main-thread cache, so the fast-lane cache stays empty. The protocol (`worker.ts`) has request ids but no cancel or supersede message, and the handler is synchronous, so a job for a slider position the learner has left runs to its 1,000 ms budget while newer jobs queue behind it. The comment's `needRef` round trip is not implemented, so `ref` arguments are never resolved in the worker.
- **Invariant broken:** S1 and S7 (design 5.13 two lanes: a cache hit or a fast finish updates the cell in the same frame).
- **Suggested fix:** try heavy ops in the fast lane with the 2 ms budget before answering `pending`; export a `cacheStore(key, cell, notices)` (or return the key in `WorkerResponse`) so the host can seed the main-thread cache with the worker's answer; add a `cancel(id)` message checked by the worker between jobs and a generation number so the host drops stale answers; either implement `needRef` or remove it from the comment.
- **status:** to be implemented
- **note:** Partly fixed: a heavy op tries a fast finish before answering pending. Still to do: seeding the main-thread cache from the worker, a cancel message, and needRef. Owner: symbolic.

## Cosmetic

### SYM-SM-27: Results left unsimplified

- **Impact:** cosmetic (correct values in clumsy forms).
- **Evidence:** `mapNodes` rebuilds `fn` nodes with `intern` and no fold (`node.ts` `mapNodes`, `fn` case), so substituted values stay unfolded: `Limit((1 - cos(x))/x^2, x, 0)` is `cos(0)/2`, and `Integral(tan(x), x, 0, 2)` prints `ln(abs(cos(0)))`. `Factor(x^2 + 1, over = complex)` is `(x - i * sqrt(4)/2) * (x + i * sqrt(4)/2)`; `Solve(x^2 == a, x)` gives `sqrt(4 * a)/2`; `CSolve(exp(x) == -1, x)` gives `ln(-1) + 2 * i * pi * k1` (design 8: `ln(-1)` is `i pi` in complex mode); `Factor(6/35)` is `6/35`, not `2 * 3 / (5 * 7)`; `Simplify((x^2 + 2*x + 1)/(x + 1)^3)` records the excluded value as `x^2 + 2 * x + 1 != 0` instead of `x != -1`; divergent integrals report "singular near -4.547473508864641e-13" for a pole at 0.
- **Invariant broken:** design 5.5 (constructors fold known values) and 5.7 (`excluded` names the values).
- **Suggested fix:** use `fn(name, ...args)` in `mapNodes`; run the `roots.pull` rule on built radicands; fold `ln(-1)` in complex mode; build `Factor` of a rational from two display products; solve linear excluded factors with `excludedFromFactor` after factoring the cancelled gcd; round the reported singular point to the exact pole when one is known.
- **status:** to be implemented
- **note:** Partly fixed: substituted function values are folded by the constructor. On `feat/cas`: square roots pull square factors (`sqrt(4 a)` is `2 sqrt(a)`), a negative half power of a whole number is a root over a number (`sqrt(2)/2`), rational quadratic roots split into a number and a root (`1 - sqrt(2)`), so `Factor(x^2 + 1, over = complex)` is `(x - i)(x + i)`. Still open: `ln(-1)` in complex mode, `Factor(6/35)`, excluded values, the singular point text. Tests: `tidy.test.ts`. Owner: symbolic.

## Fix groups

1. **Budgets and size limits** (one rule, every loop): SYM-SM-2, SYM-SM-3, SYM-SM-4, SYM-SM-6. Make the ticker required in `poly.ts` and `num.ts`, enforce `maxDigits` and `maxNodes` before every power, product and enumeration, and pass the caller's limits through `Steps`.
2. **Parser and printer round trip**: SYM-SM-1, SYM-SM-18, SYM-SM-19. Parse without re-parsing, keep keywords out of implicit products, bracket compound conditions, validate `rootof` and number literals.
3. **Run cache and determinism**: SYM-SM-7, SYM-SM-9, SYM-SM-10, SYM-SM-21. A structural, complete cache key; no swallowed budget stops; per-call family parameters; an arena rebuild that keeps constants and cache keys valid.
4. **Worker lane**: SYM-SM-8, SYM-SM-26. Re-intern on both sides of `postMessage`, cancel and stale-answer handling, a way to seed the main-thread cache.
5. **Exact arithmetic and decisions**: SYM-SM-11, SYM-SM-12, SYM-SM-13, SYM-SM-14, SYM-SM-15, SYM-SM-22, SYM-SM-23. Exact or interval decisions instead of float tolerances; exact folds for trig and rounding; pole detection.
6. **Solver cases**: SYM-SM-16, SYM-SM-24.
7. **Factoring**: SYM-SM-17, SYM-SM-25.
8. **Registries and display**: SYM-SM-5, SYM-SM-20, SYM-SM-27.

## Categories with nothing found

- **Code execution from text.** No `eval`, `new Function`, dynamic `import()` or `require` in `packages/symbolic/src/`; `ToFunction` compiles to a closure over `evalAt`, a tree walker (`bridge.ts` `compileFunction`). Text reaches only the parser.
- **Prototype pollution through symbol names.** Symbol names are only used as `Map` keys and node fields (`assume.ts` domains, `evalAt` value maps, `freeSymbols` sets); no object is written by a user-chosen key. The two prototype reads are in SYM-SM-5.
- **Assumptions leaking between calls through state.** `Assumptions` is an immutable value built per call; `Assume` facts live only for its inner `simplifyNode`. The only leak is through the cache key (SYM-SM-9).
- **Deep recursion.** The parser caps nesting at 500 and the bridge input comes from the language, which caps nesting at 64; recursive walkers (`mapNodes`, `containsInexact`, `textOf`) stayed within the stack for every input the parser accepts. `Derivative(exp(sin(x)), x, 100)` and `trigExpandOne` on long sums stop with `timeout` inside the budget.
- **Speech output.** `toSpeech` restores its module flag in `finally`; no state leaks between calls.
- **Worker messages after cancel.** There is no cancel message, so no message can follow one; the missing cancel is part of SYM-SM-26.
- **Clock handling.** Heavy ops refuse any argument that reads `t` (`run.ts` `readsClockArg`, checked on resolved arguments, lists, matrices and functions); cheap ops accept it as designed.
