# ADR 004: a small expression parser that compiles to closures

- Status: accepted for v0.1
- Date: October 2026
- Supersedes: the PRD's proposal to use a restricted math.js build (PRD 20.3)

## Context

Scenes show authored formulas such as `A*sin(w*x + phi + t)` as source, and the SDK must evaluate them safely, never with `eval` (PRD FM-1). Learners will later edit formulas too, so the evaluator is an attack surface.

## Decision

Implement a Pratt parser in `@incantly/core` that compiles an expression to a tree of closures.

- Grammar: numbers, declared variables, `+ - * / ^`, unary minus, parentheses, function calls and comparisons for piecewise forms.
- Functions come from an allow-listed table held in a prototype-free object.
- There is no property access, no strings, no assignment and no `new Function`, so the evaluator works under a strict CSP.
- The parser caps source length and nesting depth, and every error carries a source position.
- math.js is a development dependency only, used as a test oracle that checks our results.

## Consequences

- The evaluator is a few hundred lines that we own and fuzz.
- Rendered maths (PRD FM-4) still needs a display library later. This ADR covers evaluation only.

## Rejected alternatives

- **math.js:** about 172 KB gzipped for the full bundle. Version 15.2.0 fixed two parser flaws that allowed running arbitrary JavaScript, and its security page warns that more may exist.
- **expr-eval:** unmaintained with known vulnerabilities, and `toJSFunction` compiles through `new Function`.
- **filtrex:** compiles through `new Function`, which a strict CSP blocks.
